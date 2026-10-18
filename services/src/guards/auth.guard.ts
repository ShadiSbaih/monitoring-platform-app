import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import argon2 from 'argon2';
import type { Request } from 'express';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { and, eq, isNull } from 'drizzle-orm';
import {
  DRIZZLE_DB,
  LRU_CACHE,
  LRU_SOFT_TTL_MS,
  REDIS_API_KEY_TTL_SECONDS,
  REDIS_CLIENT,
  REDIS_KEYS,
  VERSION,
} from '../configs';
import type { DrizzleDatabase } from '../database/client';
import { apiKey } from '../database/schema';
import { digest } from '../utils/key-digest';
import { extractKeyId } from '../utils/api-key-verifier';

interface AuthenticatedRequest extends Request {
  user?: { id: string; keyId?: string };
}

interface CachedApiKey {
  apiKeyDigest: string;
  userId: string;
  expiresAt: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(LRU_CACHE) private readonly localCache: LRUCache<string, object>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKeyValue = request.header('x-api-key');

    if (apiKeyValue) return this.authenticateApiKey(request, apiKeyValue);

    const authorization = request.header('authorization');
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) throw new UnauthorizedException('Authentication required');

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new UnauthorizedException('Authentication is unavailable');

    try {
      const claims = await verifyToken(bearer, { secretKey });
      if (typeof claims.sub !== 'string' || !claims.sub) {
        throw new UnauthorizedException('Unauthorized');
      }
      request.user = { id: claims.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Unauthorized');
    }
  }

  private async authenticateApiKey(request: AuthenticatedRequest, plainKey: string): Promise<boolean> {
    const keyId = extractKeyId(plainKey);
    if (!keyId) throw new UnauthorizedException('Invalid API key');

    const apiKeyDigest = digest(plainKey);
    const cacheKey = `${VERSION}:${keyId}`;
    const now = Date.now();
    const local = this.localCache.get(cacheKey) as CachedApiKey | undefined;

    if (local && local.expiresAt > now && local.apiKeyDigest === apiKeyDigest) {
      this.cacheLocally(cacheKey, local.userId, apiKeyDigest, now);
      request.user = { id: local.userId, keyId };
      void this.trackApiKeyLastUsed(keyId);
      return true;
    }

    const redisKey = REDIS_KEYS.apiKey(keyId);
    const cached = await this.redis.hgetall(redisKey);
    if (cached.invalid === '1') throw new UnauthorizedException('Unauthorized');

    if (cached.api_key_digest) {
      if (cached.api_key_digest !== apiKeyDigest || !cached.user_id) {
        throw new UnauthorizedException('Unauthorized');
      }

      this.cacheLocally(cacheKey, cached.user_id, apiKeyDigest, now);
      request.user = { id: cached.user_id, keyId };
      void this.trackApiKeyLastUsed(keyId);
      return true;
    }

    const [record] = await this.db
      .select({ id: apiKey.id, user_id: apiKey.user_id, value: apiKey.value })
      .from(apiKey)
      .where(and(eq(apiKey.id, keyId), isNull(apiKey.revoked_at)))
      .limit(1);

    if (!record) throw new UnauthorizedException('Unauthorized');

    const valid = await argon2.verify(record.value, plainKey);
    if (!valid) {
      await this.redis.hset(redisKey, { invalid: '1' });
      await this.redis.expire(redisKey, REDIS_API_KEY_TTL_SECONDS);
      throw new UnauthorizedException('Unauthorized');
    }

    await this.redis.hset(redisKey, {
      user_id: record.user_id,
      api_key_digest: apiKeyDigest,
    });
    await this.redis.expire(redisKey, REDIS_API_KEY_TTL_SECONDS);
    this.cacheLocally(cacheKey, record.user_id, apiKeyDigest, now);
    request.user = { id: record.user_id, keyId };
    void this.trackApiKeyLastUsed(keyId);
    return true;
  }

  private cacheLocally(cacheKey: string, userId: string, apiKeyDigest: string, now: number): void {
    this.localCache.set(cacheKey, {
      apiKeyDigest,
      userId,
      expiresAt: now + LRU_SOFT_TTL_MS,
    });
  }

  private async trackApiKeyLastUsed(keyId: string): Promise<void> {
    try {
      const lockKey = REDIS_KEYS.apiKeyLastUsedLock(keyId);
      const locked = await this.redis.set(lockKey, '1', 'EX', 60, 'NX');
      if (locked === 'OK') {
        await this.redis.hset(REDIS_KEYS.apiKeyLastUsed, keyId, Date.now().toString());
      }
    } catch {
      // Authentication remains available if best-effort activity tracking is unavailable.
    }
  }
}
