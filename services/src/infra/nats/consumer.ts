import {
  AckPolicy,
  consumerOpts,
  DeliverPolicy,
  JSONCodec,
  type JsMsg,
} from 'nats';
import { clickhouseClient } from '../../clickhouse/client';
import {
  NATS_STREAM_NAME,
  PLAN_REDIS_TTL_SECONDS,
  REDIS_KEYS,
} from '../../configs';
import { localCache } from '../cache.module';
import { redisClient } from '../redis.module';
import { getNatsConnection } from './index';
import { broadcastLogs } from '../../sse/sse-registry';

const DURABLE_NAME = 'oml_logs_consumer';
const DELIVER_SUBJECT = 'oml.logs.worker';
const importanceValues: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const alertCodec = JSONCodec<{ logs: Record<string, unknown>[]; processedAt: number }>();

interface ConsumerManager {
  consumers: {
    info(stream: string, durable: string): Promise<{ num_pending: number }>;
  };
}

interface IngestMessage {
  keyId: string;
  userId: string;
  serverReceivedAt: number;
  logs: Record<string, unknown>[];
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 1_000_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1_000);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1_000 : numeric);
  }
  return Math.floor(Date.now() / 1_000);
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function transformLog(
  log: Record<string, unknown>,
  keyId: string,
  userId: string,
  receivedAt: number,
): Record<string, unknown> {
  const rawImportance = log.importance;
  const importance = typeof rawImportance === 'string'
    ? importanceValues[rawImportance.toLowerCase()] ?? null
    : typeof rawImportance === 'number'
      ? rawImportance
      : null;

  return {
    ...log,
    key_id: keyId,
    user_id: userId,
    type: typeof log.type === 'string' ? log.type : 'info',
    message: typeof log.message === 'string' ? log.message : '',
    app_name: typeof log.app_name === 'string' ? log.app_name : 'default',
    environment: typeof log.environment === 'string' ? log.environment : 'development',
    importance,
    track: stringifyJson(log.track),
    security: stringifyJson(log.security),
    metrics: stringifyJson(log.metrics),
    timestamp: parseTimestamp(log.timestamp ?? log.event_time),
    ingested_at: parseTimestamp(log.ingested_at ?? receivedAt),
  };
}

function updateLocalUsageCache(userId: string, increment: number): void {
  const cacheKey = `usage:${userId}`;
  const existing = localCache.get(cacheKey) as { events_used?: number | string; [key: string]: unknown } | undefined;
  if (!existing || existing.events_used === undefined) return;

  localCache.set(cacheKey, {
    ...existing,
    events_used: Number(existing.events_used) + increment,
  });
}

async function updateBacklog(manager: ConsumerManager): Promise<void> {
  const info = await manager.consumers.info(NATS_STREAM_NAME, DURABLE_NAME);
  await redisClient.set(REDIS_KEYS.ingestBacklog, String(info.num_pending));
}

async function processIngestMessage(msg: JsMsg): Promise<void> {
  let batch: IngestMessage;
  try {
    batch = msg.json<IngestMessage>();
  } catch {
    msg.term('Malformed JSON log ingest batch');
    return;
  }
  if (
    !batch ||
    !batch.userId ||
    !batch.keyId ||
    !Array.isArray(batch.logs) ||
    !batch.logs.every((log) => log && typeof log === 'object' && !Array.isArray(log))
  ) {
    msg.term('Malformed log ingest batch');
    return;
  }

  try {
    const latency = Math.max(0, Date.now() - Number(batch.serverReceivedAt || Date.now()));
    const transformed = batch.logs.map((log) =>
      transformLog(log, batch.keyId, batch.userId, batch.serverReceivedAt),
    );

    await redisClient.lpush(REDIS_KEYS.ingestLatency, latency);
    await redisClient.ltrim(REDIS_KEYS.ingestLatency, 0, 59);

    if (transformed.length > 0) {
      await clickhouseClient.insert({
        table: 'logs.events',
        values: transformed,
        format: 'JSONEachRow',
      });
      const rateBucket = REDIS_KEYS.ingestRateBucket(Math.floor(Date.now() / 1_000));
      const ingestRate = await redisClient.incrby(rateBucket, transformed.length);
      await redisClient.expire(rateBucket, 2);
      await redisClient.set(REDIS_KEYS.ingestRate, String(ingestRate), 'EX', 2);
      const connection = await getNatsConnection();
      await connection.jetstream().publish(
        'logs.alert.evaluate',
        alertCodec.encode({ logs: transformed, processedAt: Date.now() }),
      );
      const usageKey = REDIS_KEYS.usage(batch.userId);
      await redisClient.hincrby(usageKey, 'events_used', transformed.length);
      await redisClient.expire(usageKey, PLAN_REDIS_TTL_SECONDS);
      await redisClient.sadd(REDIS_KEYS.usageDirty, batch.userId);
      updateLocalUsageCache(batch.userId, transformed.length);
      broadcastLogs(transformed);
    }

    msg.ack();
  } catch (error) {
    console.error('Failed to process log ingest batch', error);
    msg.nak(1_000);
  }
}

async function processSubscription(subscription: AsyncIterable<JsMsg>): Promise<void> {
  let lastBacklogUpdateAt = 0;
  const connection = await getNatsConnection();
  const manager = await connection.jetstreamManager();

  try {
    for await (const msg of subscription) {
      await processIngestMessage(msg);
      const now = Date.now();
      if (now - lastBacklogUpdateAt >= 1_000) {
        lastBacklogUpdateAt = now;
        try {
          await updateBacklog(manager);
        } catch (error) {
          console.warn('Unable to refresh NATS ingest backlog metric', error);
        }
      }
    }
  } catch (error) {
    console.error('NATS log consumer stopped unexpectedly', error);
  }
}

let started = false;

export async function startLogsConsumer(): Promise<void> {
  if (started) return;

  const connection = await getNatsConnection();
  const manager = await connection.jetstreamManager();
  try {
    await manager.consumers.info(NATS_STREAM_NAME, DURABLE_NAME);
  } catch {
    await manager.consumers.add(NATS_STREAM_NAME, {
      durable_name: DURABLE_NAME,
      deliver_subject: DELIVER_SUBJECT,
      filter_subject: 'logs.ingest',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      max_ack_pending: 1_000,
    });
  }

  const subscription = await connection.jetstream().subscribe(
    'logs.ingest',
    consumerOpts().bind(NATS_STREAM_NAME, DURABLE_NAME).manualAck(),
  );
  started = true;
  void processSubscription(subscription);
}
