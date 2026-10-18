import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { DRIZZLE_DB, REDIS_CLIENT, REDIS_KEYS } from '../configs';
import type { DrizzleDatabase } from '../database/client';
import { usage as usageTable } from '../database/schema';

@Injectable()
export class UsageDbSync {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/5 * * * *')
  async syncFlushUsage(): Promise<void> {
    const processingKey = `${REDIS_KEYS.usageDirty}:processing:${Date.now()}`;
    const renamed = await this.redis.rename(REDIS_KEYS.usageDirty, processingKey).catch(() => null);
    if (renamed === null) return;

    try {
      const userIds = await this.redis.smembers(processingKey);
      for (const userId of userIds) {
        try {
          const counters = await this.redis.hgetall(REDIS_KEYS.usage(userId));
          if (counters.events_used === undefined) continue;

          const eventsUsed = Number(counters.events_used);
          const eventsLimit = Number(counters.events_limit);
          if (!Number.isFinite(eventsUsed) || !Number.isFinite(eventsLimit)) {
            console.warn(`Skipping invalid Redis usage counters for user ${userId}`);
            await this.redis.sadd(REDIS_KEYS.usageDirty, userId);
            continue;
          }

          await this.db
            .update(usageTable)
            .set({ events_used: eventsUsed, events_limit: eventsLimit, updated_at: new Date() })
            .where(eq(usageTable.user_id, userId));
        } catch (error) {
          console.error(`Unable to sync usage counters for user ${userId}`, error);
          // Keep failed users in the active dirty set for the next scheduled attempt.
          await this.redis.sadd(REDIS_KEYS.usageDirty, userId).catch((redisError) => {
            console.error(`Unable to requeue usage sync for user ${userId}`, redisError);
          });
        }
      }
    } finally {
      await this.redis.del(processingKey);
    }
  }
}
