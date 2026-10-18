import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { db, closeDatabase } from '../database/client';
import { alerts, logEvents, ingestBatches, alertDeliveries, alertOutbox, emailTokens, sessions, usage } from '../database/schema';
import { FREE_LIMITS, REDIS_KEYS, STREAMS } from '../configs';
import { redisClient, closeRedisConnection } from './redis.module';
import { startWorkers } from './start-workers';
import { stopConsumers } from './streams/queue';
@Injectable()
export class InfrastructureBootstrap implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  async onApplicationBootstrap() {
    if (!process.env.WEBHOOK_SIGNING_SECRET || !process.env.REDIS_KEY_SECRET) throw new Error('Configure webhook and API-key signing secrets');
    // Rebuild persistent alert caches on every cold start before consuming jobs.
    const rules = await db.select().from(alerts);
    const grouped = new Map<string, typeof rules>();
    for (const rule of rules) grouped.set(rule.user_id, [...(grouped.get(rule.user_id) ?? []), rule]);
    for (const [userId, values] of grouped) await redisClient.set(REDIS_KEYS.alerts(userId), JSON.stringify(values));
    await this.cleanup();
    await startWorkers();
    this.timer = setInterval(() => { void this.cleanup().catch(() => console.error('Retention cleanup failed')); }, 3_600_000);
    this.timer.unref();
  }
  async cleanup() {
    const now = new Date();
    const cutoff = new Date(Date.now() - FREE_LIMITS.retentionDays * 86_400_000);
    const old = new Date(Date.now() - 10 * 86_400_000);
    await db.delete(logEvents).where(lt(logEvents.ingested_at, cutoff));
    await db.delete(ingestBatches).where(lt(ingestBatches.created_at, old));
    await db.delete(alertDeliveries).where(lt(alertDeliveries.created_at, old));
    await db.delete(alertOutbox).where(lt(alertOutbox.created_at, cutoff));
    await redisClient.command('XTRIM', STREAMS.dead, 'MINID', String(cutoff.getTime()) + '-0');
    await db.delete(emailTokens).where(lt(emailTokens.expires_at, now));
    await db.delete(sessions).where(lt(sessions.expires_at, now));
    await db.delete(usage).where(lt(usage.day, cutoff.toISOString().slice(0, 10)));
  }
  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    stopConsumers();
    await Promise.allSettled([closeDatabase(), closeRedisConnection()]);
  }
}
