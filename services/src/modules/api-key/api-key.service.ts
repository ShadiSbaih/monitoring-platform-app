import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  DRIZZLE_DB,
  LRU_CACHE,
  REDIS_CLIENT,
  REDIS_KEYS,
  VERSION,
} from '../../configs';
import type { DrizzleDatabase } from '../../database/client';
import { apiKey } from '../../database/schema';

const MAX_API_KEYS_PER_USER = 5;

function normalizeKeyId(keyId: string): string {
  const normalized = keyId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) throw new NotFoundException('API key not found');
  return normalized;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(LRU_CACHE) private readonly localCache: LRUCache<string, object>,
  ) {}

  async createApiKey(userId: string): Promise<{ key: string }> {
    const [result] = await this.db
      .select({ total: count() })
      .from(apiKey)
      .where(eq(apiKey.user_id, userId));

    if ((result?.total ?? 0) >= MAX_API_KEYS_PER_USER) {
      throw new BadRequestException(
        'You have reached the maximum limit of 5 API keys. Please contact support for more.',
      );
    }

    const keyId = randomUUID().replace(/-/g, '');
    const plainTextKey = `oml_${keyId}_${randomBytes(32).toString('base64url')}`;
    const hashedValue = await argon2.hash(plainTextKey, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 1 << 16,
      parallelism: 1,
    });

    await this.db.insert(apiKey).values({
      id: keyId,
      user_id: userId,
      value: hashedValue,
      prefix: `${plainTextKey.slice(0, 18)}...`,
    });

    return { key: plainTextKey };
  }

  async listApiKeys(userId: string) {
    const keys = await this.db
      .select({
        id: apiKey.id,
        prefix: apiKey.prefix,
        created_at: apiKey.created_at,
        last_used_at: apiKey.last_used_at,
        revoked_at: apiKey.revoked_at,
      })
      .from(apiKey)
      .where(eq(apiKey.user_id, userId))
      .orderBy(desc(apiKey.created_at));

    return Promise.all(
      keys.map(async (key) => {
        const cachedTimestamp = await this.redis.hget(
          REDIS_KEYS.apiKeyLastUsed,
          normalizeKeyId(key.id),
        );
        const timestamp = cachedTimestamp === null ? NaN : Number(cachedTimestamp);
        return {
          ...key,
          last_used_at: Number.isFinite(timestamp) ? new Date(timestamp) : key.last_used_at,
        };
      }),
    );
  }

  async getApiKeyLastUsed(userId: string, keyId: string): Promise<{ last_used_at: Date | null }> {
    const normalizedKeyId = normalizeKeyId(keyId);
    const cachedTimestamp = await this.redis.hget(REDIS_KEYS.apiKeyLastUsed, normalizedKeyId);
    if (cachedTimestamp !== null) {
      const [owner] = await this.db
        .select({ id: apiKey.id })
        .from(apiKey)
        .where(and(eq(apiKey.user_id, userId), eq(apiKey.id, normalizedKeyId)))
        .limit(1);
      if (!owner) throw new NotFoundException('API key not found');

      const timestamp = Number(cachedTimestamp);
      return { last_used_at: Number.isFinite(timestamp) ? new Date(timestamp) : null };
    }

    const [record] = await this.db
      .select({ last_used_at: apiKey.last_used_at })
      .from(apiKey)
      .where(and(eq(apiKey.user_id, userId), eq(apiKey.id, normalizedKeyId)))
      .limit(1);
    if (!record) throw new NotFoundException('API key not found');

    return { last_used_at: record.last_used_at };
  }

  async deleteApiKey(userId: string, keyId: string): Promise<{ revoked: true }> {
    const normalizedKeyId = normalizeKeyId(keyId);
    const [revoked] = await this.db
      .update(apiKey)
      .set({ revoked_at: new Date() })
      .where(
        and(
          eq(apiKey.user_id, userId),
          eq(apiKey.id, normalizedKeyId),
          isNull(apiKey.revoked_at),
        ),
      )
      .returning({ id: apiKey.id });

    if (!revoked) throw new NotFoundException('API key not found');
    await this.evictApiKeyCaches(normalizedKeyId);
    return { revoked: true };
  }

  async regenerateApiKey(userId: string, keyId: string): Promise<{ key: string }> {
    const normalizedKeyId = normalizeKeyId(keyId);
    const plainTextKey = `oml_${normalizedKeyId}_${randomBytes(32).toString('base64url')}`;
    const hashedValue = await argon2.hash(plainTextKey, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 1 << 16,
      parallelism: 1,
    });

    const [updated] = await this.db
      .update(apiKey)
      .set({
        value: hashedValue,
        prefix: `${plainTextKey.slice(0, 18)}...`,
        created_at: new Date(),
      })
      .where(
        and(
          eq(apiKey.user_id, userId),
          eq(apiKey.id, normalizedKeyId),
          isNull(apiKey.revoked_at),
        ),
      )
      .returning({ id: apiKey.id });

    if (!updated) throw new NotFoundException('API key not found');
    await this.evictApiKeyCaches(normalizedKeyId);
    return { key: plainTextKey };
  }

  private async evictApiKeyCaches(keyId: string): Promise<void> {
    await this.redis.del(REDIS_KEYS.apiKey(keyId));
    await this.redis.hdel(REDIS_KEYS.apiKeyLastUsed, keyId);
    this.localCache.delete(`${VERSION}:${keyId}`);
  }
}
