import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import argon2 from 'argon2';
import { and, eq, isNull } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { DRIZZLE_DB, LRU_CACHE, LRU_SOFT_TTL_MS, REDIS_API_KEY_TTL_SECONDS, REDIS_CLIENT, REDIS_KEYS, VERSION } from '../configs';
import type { DrizzleDatabase } from '../database/client';
import { apiKey } from '../database/schema';
import { RedisClient } from '../infra/redis.module';
import { AuthService } from '../modules/auth/auth.service';
import { digest } from '../utils/key-digest';
import { extractKeyId } from '../utils/api-key-verifier';
interface Cached { userId: string; apiKeyDigest: string; expiresAt: number }
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    @Inject(LRU_CACHE) private readonly cache: LRUCache<string, object>,
    private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const key = req.header('x-api-key');
    if (key) {
      const keyId = extractKeyId(key);
      if (!keyId) throw new UnauthorizedException('Invalid API key');
      const hashed = digest(key);
      const localKey = VERSION + ':' + keyId;
      const now = Date.now();
      let userId: string | undefined;
      const local = this.cache.get(localKey) as Cached | undefined;
      if (local && local.expiresAt > now && local.apiKeyDigest === hashed) userId = local.userId;
      if (!userId) {
        const redisKey = REDIS_KEYS.apiKey(keyId);
        const cached = await this.redis.hgetall(redisKey);
        if (cached.api_key_digest) {
          if (cached.api_key_digest !== hashed) throw new UnauthorizedException('Invalid API key');
          userId = cached.user_id;
        } else {
          const negative = redisKey + ':invalid:' + hashed;
          if (await this.redis.exists(negative)) throw new UnauthorizedException('Invalid API key');
          const [record] = await this.db.select().from(apiKey).where(and(eq(apiKey.id, keyId), isNull(apiKey.revoked_at))).limit(1);
          if (!record || !await argon2.verify(record.value, key)) {
            await this.redis.set(negative, '1', 'EX', REDIS_API_KEY_TTL_SECONDS);
            throw new UnauthorizedException('Invalid API key');
          }
          userId = record.user_id;
          await this.redis.hset(redisKey, { user_id: userId, api_key_digest: hashed });
          await this.redis.expire(redisKey, REDIS_API_KEY_TTL_SECONDS);
        }
        this.cache.set(localKey, { userId, apiKeyDigest: hashed, expiresAt: now + LRU_SOFT_TTL_MS });
      }
      req.user = { id: userId, keyId };
      if (!this.cache.has('last-used:' + keyId)) {
        this.cache.set('last-used:' + keyId, {}, { ttl: 60_000 });
        void this.redis.hset(REDIS_KEYS.apiKeyLastUsed, { [keyId]: now }).catch(() => {});
      }
      return true;
    }
    const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) throw new UnauthorizedException('Authentication required');
    req.user = await this.auth.verifyAccess(bearer);
    return true;
  }
}
