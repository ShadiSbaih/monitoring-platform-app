import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../database/client";
import {
  alerts,
  alertDeliveries,
  type AlertCondition,
} from "../../database/schema";
import { FREE_LIMITS, REDIS_KEYS } from "../../configs";
import { redisClient } from "../redis.module";
import { postWebhook } from "../../utils/webhook";
type Rule = typeof alerts.$inferSelect;
export function matchCondition(
  log: Record<string, unknown>,
  condition: AlertCondition,
) {
  const names: Record<number, string> = {
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
  };
  const raw = log[condition.field];
  const actual = String(
    condition.field === "importance" && typeof raw === "number"
      ? names[raw]
      : (raw ?? ""),
  ).toLowerCase();
  const expected = String(condition.value).toLowerCase();
  switch (condition.operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    default:
      return false;
  }
}
const COUNT_SCRIPT = `
local prior=redis.call('GET',KEYS[1]); if prior then return tonumber(prior) end
local n=redis.call('INCRBY',KEYS[2],ARGV[1]); redis.call('EXPIRE',KEYS[2],ARGV[2])
local trigger=0
if n>=tonumber(ARGV[3]) and redis.call('SET',KEYS[3],'1','NX','EX',ARGV[4]) then trigger=1 end
redis.call('SET',KEYS[1],trigger,'EX',864000)
return trigger
`;
export async function processAlerts(
  payload: Record<string, unknown>,
  deliver = postWebhook,
) {
  const userId = String(payload.userId ?? "");
  const batchId = String(payload.batchId ?? "");
  if (!userId || !batchId || !Array.isArray(payload.logs))
    throw new Error("Malformed alert job");
  if (
    Date.now() - Number(payload.receivedAt) >
    FREE_LIMITS.retentionDays * 86_400_000
  )
    return;
  const cached = await redisClient.get(REDIS_KEYS.alerts(userId));
  if (!cached) return;
  const rules = JSON.parse(cached) as Rule[];
  for (const rule of rules) {
    if (rule.status !== "active" || rule.user_id !== userId) continue;
    const matching = (payload.logs as Record<string, unknown>[]).filter(
      (log) =>
        log.app_name === rule.app_name &&
        rule.conditions.every((condition) => matchCondition(log, condition)),
    );
    if (!matching.length) continue;
    const seconds = rule.threshold_window_minutes * 60;
    const bucket = Math.floor(Number(payload.receivedAt) / 1_000 / seconds);
    const match = rule.cooldown_period.match(/^(\d+)([smhd])$/);
    const cooldown = match
      ? Number(match[1]) *
        ({ s: 1, m: 60, h: 3_600, d: 86_400 }[match[2]] ?? 60)
      : 300;
    const eventId = rule.id + ":" + batchId;
    const shouldTrigger = await redisClient.eval<number>(
      COUNT_SCRIPT,
      [
        "oml:alert:seen:" + eventId,
        "oml:alert:count:" + rule.id + ":" + bucket,
        "oml:alert:cooldown:" + rule.id,
      ],
      [matching.length, seconds + 60, rule.threshold_count, cooldown],
    );
    if (!shouldTrigger) continue;
    await db
      .insert(alertDeliveries)
      .values({ id: eventId, alert_id: rule.id })
      .onConflictDoNothing();
    const [delivery] = await db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.id, eventId))
      .limit(1);
    if (delivery.delivered_at) continue;
    const body = JSON.stringify({
      event_id: eventId,
      type: "alert.triggered",
      alert_id: rule.id,
      alert_name: rule.name,
      app_name: rule.app_name,
      matched_count: matching.length,
      sample_log: matching[0],
      triggered_at: delivery.created_at.toISOString(),
    });
    const secret = process.env.WEBHOOK_SIGNING_SECRET;
    if (!secret) throw new Error("Webhook signing secret is required");
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(timestamp + "." + body)
      .digest("hex");
    await deliver(rule.webhook_url, body, {
      "Content-Type": "application/json",
      "X-OML-Event-Id": eventId,
      "X-OML-Signature": signature,
      "X-OML-Timestamp": timestamp,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(alertDeliveries)
        .set({ delivered_at: new Date() })
        .where(eq(alertDeliveries.id, eventId));
      await tx
        .update(alerts)
        .set({ last_triggered: new Date(), updated_at: new Date() })
        .where(and(eq(alerts.id, rule.id), eq(alerts.user_id, userId)));
    });
    rule.last_triggered = new Date();
  }
}
