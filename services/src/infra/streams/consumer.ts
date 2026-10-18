import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../database/client";
import {
  alertOutbox,
  ingestBatches,
  logEvents,
  usage,
} from "../../database/schema";
import { broadcastLogs } from "../../sse/sse-registry";
import { FREE_LIMITS, STREAMS } from "../../configs";
import { redisClient } from "../redis.module";
import { type IngestJob, utcDay, wakeWorkers } from "./queue";
import { changeBacklog, recordIngest } from "./telemetry";

export function normalizeLog(
  log: Record<string, unknown>,
  job: IngestJob,
  index: number,
) {
  let timestamp = log.timestamp ?? log.event_time;
  if (typeof timestamp === "number")
    timestamp = timestamp < 1e12 ? timestamp * 1_000 : timestamp;
  const parsed = timestamp
    ? new Date(timestamp as string | number)
    : new Date(job.receivedAt);
  const importance =
    typeof log.importance === "number"
      ? ({ 1: "low", 2: "medium", 3: "high", 4: "critical" }[log.importance] ??
        null)
      : typeof log.importance === "string"
        ? log.importance
        : null;
  return {
    id: createHash("sha256")
      .update(job.userId + ":" + job.batchId + ":" + index)
      .digest("hex"),
    user_id: job.userId,
    key_id: job.keyId,
    type: typeof log.type === "string" ? log.type : "info",
    message: typeof log.message === "string" ? log.message : "",
    app_name: typeof log.app_name === "string" ? log.app_name : "default",
    environment:
      typeof log.environment === "string" ? log.environment : "development",
    importance,
    payload: log,
    timestamp: Number.isFinite(parsed.getTime())
      ? parsed
      : new Date(job.receivedAt),
    ingested_at: new Date(job.receivedAt),
  };
}
const PUBLISH_ALERT = `
if redis.call('EXISTS',KEYS[1])==1 then return 0 end
redis.call('XADD',KEYS[2],'*','payload',ARGV[1])
redis.call('SET',KEYS[1],'1','EX',864000)
return 1
`;
export async function processIngest(payload: Record<string, unknown>) {
  const job = payload as unknown as IngestJob;
  if (!job.userId || !job.batchId || !Array.isArray(job.logs))
    throw new Error("Malformed ingest job");
  if (Date.now() - job.receivedAt > FREE_LIMITS.retentionDays * 86_400_000)
    return;
  const id = job.userId + ":" + job.batchId;
  const rows = job.logs.map((log, index) => normalizeLog(log, job, index));
  const inserted = await db.transaction(async (tx) => {
    const batch = await tx
      .insert(ingestBatches)
      .values({ id, user_id: job.userId })
      .onConflictDoNothing()
      .returning();
    if (!batch.length) return false;
    await tx.insert(logEvents).values(rows).onConflictDoNothing();
    await tx
      .insert(usage)
      .values({
        user_id: job.userId,
        day: utcDay(job.receivedAt),
        events_used: rows.length,
      })
      .onConflictDoUpdate({
        target: [usage.user_id, usage.day],
        set: { events_used: sql`${usage.events_used} + ${rows.length}` },
      });
    await tx
      .insert(alertOutbox)
      .values({
        id,
        payload: {
          batchId: job.batchId,
          userId: job.userId,
          receivedAt: job.receivedAt,
          bytes: job.bytes,
          logs: rows.map((row) => ({
            ...row.payload,
            ...row,
            payload: undefined,
          })),
        },
      })
      .onConflictDoNothing();
    return true;
  });
  // A committed outbox survives a crash between Postgres commit and Redis publish.
  const [outbox] = await db
    .select()
    .from(alertOutbox)
    .where(eq(alertOutbox.id, id))
    .limit(1);
  if (outbox && !outbox.dispatched_at) {
    const published = await redisClient.eval<number>(
      PUBLISH_ALERT,
      ["oml:alert:published:" + id, STREAMS.alerts],
      [JSON.stringify(outbox.payload)],
    );
    if (published) changeBacklog(1);
    await db
      .update(alertOutbox)
      .set({ dispatched_at: new Date() })
      .where(eq(alertOutbox.id, id));
    wakeWorkers(STREAMS.alerts);
  }
  if (inserted) {
    recordIngest(job.userId, rows.length, job.receivedAt);
    broadcastLogs(
      rows.map((row) => ({ ...row.payload, ...row, payload: undefined })),
    );
  }
}
