import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import {
  DRIZZLE_DB,
  LRU_CACHE,
  PLAN_DEFAULTS,
  REDIS_CLIENT,
  REDIS_KEYS,
  REDIS_PLAN_TTL_SECONDS,
  PlanTier,
  normalizePlanTier,
} from '../configs';
import type { DrizzleDatabase } from '../database/client';
import { plan as planTable, usage as usageTable } from '../database/schema';

interface GuardRequest extends Request {
  user?: { id: string; keyId?: string };
  plan?: PlanTier;
}

interface PlanCacheValue {
  name: PlanTier;
}

interface UsageCacheValue {
  events_used: number;
  events_limit: number;
}

@Injectable()
export class UsageGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(LRU_CACHE) private readonly localCache: LRUCache<string, object>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication required');

    await this.isHardLocked(userId);
    const resolvedPlan = await this.resolvePlan(userId);
    request.plan = resolvedPlan;

    const defaults = PLAN_DEFAULTS[resolvedPlan];
    const currentUsage = await this.getOrCreateUsage(userId, defaults.eventsLimit);
    const effectiveUsageLimit = currentUsage.events_limit > 0
      ? currentUsage.events_limit
      : defaults.eventsLimit;

    if (currentUsage.events_used >= effectiveUsageLimit) {
      throw new ForbiddenException(
        'You have reached your usage quota. Please upgrade your 1 Minute Logs account plan to upload more events.',
      );
    }
    return true;
  }

  private async isHardLocked(userId: string): Promise<void> {
    if (await this.redis.exists(REDIS_KEYS.hardLock(userId))) {
      throw new ForbiddenException(
        'Your account has been locked. You have exceeded the usage limit for your current plan. Please upgrade your 1 Minute Logs account plan to continue uploading logs.',
      );
    }
  }

  private async resolvePlan(userId: string): Promise<PlanTier> {
    const cacheKey = `plan:${userId}`;
    const local = this.localCache.get(cacheKey) as PlanCacheValue | undefined;
    if (local?.name) return normalizePlanTier(local.name);

    const redisKey = REDIS_KEYS.plan(userId);
    const cached = await this.redis.hgetall(redisKey);
    if (cached.name) {
      const name = normalizePlanTier(cached.name);
      void this.redis.expire(redisKey, REDIS_PLAN_TTL_SECONDS).catch(() => undefined);
      this.localCache.set(cacheKey, { name });
      return name;
    }

    if (!process.env.DATABASE_URL) {
      const name = PlanTier.FREE;
      await this.redis.hset(redisKey, { name });
      await this.redis.expire(redisKey, REDIS_PLAN_TTL_SECONDS);
      this.localCache.set(cacheKey, { name });
      return name;
    }

    const [record] = await this.db
      .select({ name: planTable.name })
      .from(planTable)
      .where(eq(planTable.user_id, userId))
      .limit(1);
    const name = normalizePlanTier(record?.name ?? PlanTier.FREE);

    await this.redis.hset(redisKey, { name });
    await this.redis.expire(redisKey, REDIS_PLAN_TTL_SECONDS);
    this.localCache.set(cacheKey, { name });
    return name;
  }

  private async getOrCreateUsage(userId: string, defaultLimit: number): Promise<UsageCacheValue> {
    const cacheKey = `usage:${userId}`;
    const local = this.localCache.get(cacheKey) as UsageCacheValue | undefined;
    if (local && Number.isFinite(Number(local.events_used)) && Number.isFinite(Number(local.events_limit))) {
      return { events_used: Number(local.events_used), events_limit: Number(local.events_limit) };
    }

    const redisKey = REDIS_KEYS.usage(userId);
    const cached = await this.redis.hgetall(redisKey);
    if (cached.events_used !== undefined && cached.events_limit !== undefined) {
      const value = {
        events_used: Number(cached.events_used),
        events_limit: Number(cached.events_limit),
      };
      this.localCache.set(cacheKey, value);
      return value;
    }

    if (!process.env.DATABASE_URL) {
      const value = { events_used: 0, events_limit: defaultLimit };
      await this.redis.hset(redisKey, {
        events_used: String(value.events_used),
        events_limit: String(value.events_limit),
      });
      await this.redis.expire(redisKey, REDIS_PLAN_TTL_SECONDS);
      this.localCache.set(cacheKey, value);
      return value;
    }

    let [record] = await this.db
      .select({ events_used: usageTable.events_used, events_limit: usageTable.events_limit })
      .from(usageTable)
      .where(eq(usageTable.user_id, userId))
      .limit(1);

    if (!record) {
      await this.db
        .insert(usageTable)
        .values({ user_id: userId, events_used: 0, events_limit: defaultLimit })
        .onConflictDoNothing();
      [record] = await this.db
        .select({ events_used: usageTable.events_used, events_limit: usageTable.events_limit })
        .from(usageTable)
        .where(eq(usageTable.user_id, userId))
        .limit(1);
    }

    const value = {
      events_used: Number(record?.events_used ?? 0),
      events_limit: Number(record?.events_limit ?? defaultLimit),
    };
    await this.redis.hset(redisKey, {
      events_used: String(value.events_used),
      events_limit: String(value.events_limit),
    });
    await this.redis.expire(redisKey, REDIS_PLAN_TTL_SECONDS);
    this.localCache.set(cacheKey, value);
    return value;
  }
}
