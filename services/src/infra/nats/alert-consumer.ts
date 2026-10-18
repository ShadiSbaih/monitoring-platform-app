import { createHmac, randomUUID } from 'node:crypto';
import {
  AckPolicy,
  consumerOpts,
  DeliverPolicy,
  JSONCodec,
  type JsMsg,
} from 'nats';
import { and, eq } from 'drizzle-orm';
import { NATS_STREAM_NAME, REDIS_KEYS } from '../../configs';
import { db } from '../../database/client';
import type { AlertCondition } from '../../database/schema';
import { alerts } from '../../database/schema';
import { redisClient } from '../redis.module';
import { getNatsConnection } from './index';

const DURABLE_NAME = 'oml_alert_consumer';
const DELIVER_SUBJECT = 'oml.alert.worker';

interface AlertRule {
  id: string;
  user_id: string;
  name: string;
  app_name: string;
  conditions: AlertCondition[];
  threshold_count: number;
  threshold_window_minutes: number;
  webhook_url: string;
  cooldown_period: string;
  last_triggered: string | Date | null;
  [key: string]: unknown;
}

interface AlertEvaluationMessage {
  logs: Record<string, unknown>[];
  processedAt: number;
}

const codec = JSONCodec<AlertEvaluationMessage>();
const importanceNames: Record<number, string> = {
  4: 'critical',
  3: 'high',
  2: 'medium',
  1: 'low',
};

function normalize(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return importanceNames[value] ?? String(value).toLowerCase();
  }
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function matchCondition(log: Record<string, unknown>, condition: AlertCondition): boolean {
  const field = condition.field === 'environment' ? 'environment' : condition.field;
  const actual = normalize(log[field]);
  const expected = normalize(condition.value);
  switch (condition.operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    default:
      return false;
  }
}

function parseCooldownSeconds(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!match) return 300;
  const amount = Math.max(1, Number(match[1]));
  const seconds: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
  return amount * seconds[match[2]];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function callWebhook(rule: AlertRule, matchedLogs: Record<string, unknown>[]): Promise<void> {
  const eventId = randomUUID();
  const triggeredAt = new Date().toISOString();
  const payload = {
    event_id: eventId,
    type: 'alert.triggered',
    alert_id: rule.id,
    alert_name: rule.name,
    app_name: rule.app_name,
    matched_count: matchedLogs.length,
    sample_log: matchedLogs[0],
    triggered_at: triggeredAt,
  };
  const payloadJson = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const secret = process.env.WEBHOOK_SIGNING_SECRET;

  if (!secret || secret.includes('replace-with-')) {
    console.info(`Mock webhook delivery for alert ${rule.id} (${eventId})`);
    return;
  }

  const signature = createHmac('sha256', secret).update(`${timestamp}.${payloadJson}`).digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(rule.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OneMinuteLogs-Webhooks/1.0',
        'X-OML-Event-Id': eventId,
        'X-OML-Signature': signature,
        'X-OML-Timestamp': timestamp,
      },
      body: payloadJson,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function triggerRule(
  userId: string,
  rules: AlertRule[],
  rule: AlertRule,
  matchedLogs: Record<string, unknown>[],
): Promise<void> {
  if (matchedLogs.length === 0) return;
  const windowSeconds = Math.max(1, Number(rule.threshold_window_minutes) * 60);
  const bucket = Math.floor(Date.now() / 1_000 / windowSeconds);
  const countKey = REDIS_KEYS.alertCount(rule.id, bucket);
  const count = await redisClient.incrby(countKey, matchedLogs.length);
  await redisClient.expire(countKey, windowSeconds);
  if (count < Number(rule.threshold_count)) return;

  const cooldownKey = REDIS_KEYS.alertCooldown(rule.id);
  if (await redisClient.exists(cooldownKey)) return;

  await callWebhook(rule, matchedLogs);
  const cooldownSeconds = parseCooldownSeconds(rule.cooldown_period);
  await redisClient.set(cooldownKey, '1', 'EX', cooldownSeconds);

  const triggeredAt = new Date();
  rule.last_triggered = triggeredAt.toISOString();
  await redisClient.set(REDIS_KEYS.alerts(userId), JSON.stringify(rules));
  if (process.env.DATABASE_URL) {
    await db.update(alerts)
      .set({ last_triggered: triggeredAt, updated_at: triggeredAt })
      .where(and(eq(alerts.id, rule.id), eq(alerts.user_id, userId)));
  }
}

async function evaluateMessage(msg: JsMsg): Promise<void> {
  let payload: AlertEvaluationMessage;
  try {
    payload = msg.json<AlertEvaluationMessage>();
  } catch {
    msg.term('Malformed alert evaluation payload');
    return;
  }
  if (!payload || !Array.isArray(payload.logs)) {
    msg.term('Malformed alert evaluation payload');
    return;
  }

  try {
    const groupedLogs = new Map<string, Record<string, unknown>[]>();
    for (const log of payload.logs) {
      if (!log || typeof log !== 'object' || Array.isArray(log)) continue;
      const userId = stringValue(log.user_id);
      if (!userId) continue;
      const userLogs = groupedLogs.get(userId) ?? [];
      userLogs.push(log);
      groupedLogs.set(userId, userLogs);
    }

    for (const [userId, userLogs] of groupedLogs) {
      // This high-throughput path deliberately reads only the persistent Redis alert cache.
      const cachedRules = await redisClient.get(REDIS_KEYS.alerts(userId));
      if (!cachedRules) continue;
      let rules: AlertRule[];
      try {
        const parsed = JSON.parse(cachedRules) as unknown;
        rules = Array.isArray(parsed) ? parsed as AlertRule[] : [];
      } catch {
        console.error(`Invalid Redis alert cache for user ${userId}`);
        continue;
      }

      for (const rule of rules) {
        if (rule.status !== 'active') continue;
        const matchedLogs = userLogs.filter((log) =>
          normalize(log.app_name) === normalize(rule.app_name) &&
          Array.isArray(rule.conditions) &&
          rule.conditions.every((condition) => matchCondition(log, condition)),
        );
        await triggerRule(userId, rules, rule, matchedLogs);
      }
    }
    msg.ack();
  } catch (error) {
    console.error('Failed to evaluate alert rules', error);
    msg.nak(1_000);
  }
}

async function processSubscription(subscription: AsyncIterable<JsMsg>): Promise<void> {
  try {
    for await (const msg of subscription) await evaluateMessage(msg);
  } catch (error) {
    console.error('NATS alert consumer stopped unexpectedly', error);
  }
}

let started = false;

export async function startAlertConsumer(): Promise<void> {
  if (started) return;
  const connection = await getNatsConnection();
  const manager = await connection.jetstreamManager();
  try {
    await manager.consumers.info(NATS_STREAM_NAME, DURABLE_NAME);
  } catch {
    await manager.consumers.add(NATS_STREAM_NAME, {
      durable_name: DURABLE_NAME,
      deliver_subject: DELIVER_SUBJECT,
      filter_subject: 'logs.alert.evaluate',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_ack_pending: 1_000,
    });
  }

  const subscription = await connection.jetstream().subscribe(
    'logs.alert.evaluate',
    consumerOpts().bind(NATS_STREAM_NAME, DURABLE_NAME).manualAck(),
  );
  started = true;
  void processSubscription(subscription);
}
