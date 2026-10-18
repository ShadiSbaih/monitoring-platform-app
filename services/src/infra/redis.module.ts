import 'dotenv/config';
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../configs';

export class RedisClient {
  private readonly tcp?: Redis;
  constructor() {
    if (process.env.REDIS_URL) {
      if (!process.env.REDIS_URL.startsWith('rediss://')) throw new Error('REDIS_URL must use TLS (rediss://)');
      this.tcp = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: false });
      this.tcp.on('error', () => console.error('Upstash TCP connection failed'));
    }
  }
  async command<T = unknown>(...args: (string | number)[]): Promise<T> {
    if (this.tcp) return this.tcp.call(String(args[0]), ...args.slice(1)) as Promise<T>;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url?.startsWith('https://') || !token) throw new Error('Configure Upstash Redis REST URL/token or REDIS_URL');
    const response = await fetch(url, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null) as { result: T; error?: string } | null;
    if (body?.error) throw new Error(body.error);
    if (!response.ok || !body) throw new Error('Upstash request failed (' + response.status + ')');
    return body.result;
  }
  get(key: string) { return this.command<string | null>('GET', key); }
  set(key: string, value: string | number, ...args: (string | number)[]) { return this.command<string | null>('SET', key, value, ...args); }
  del(...keys: string[]) { return this.command<number>('DEL', ...keys); }
  exists(key: string) { return this.command<number>('EXISTS', key); }
  expire(key: string, seconds: number) { return this.command<number>('EXPIRE', key, seconds); }
  hget(key: string, field: string) { return this.command<string | null>('HGET', key, field); }
  async hgetall(key: string): Promise<Record<string, string>> {
    const raw = await this.command<string[] | Record<string, string>>('HGETALL', key);
    return Array.isArray(raw) ? Object.fromEntries(Array.from({ length: raw.length / 2 }, (_, i) => [raw[i * 2], raw[i * 2 + 1]])) : raw;
  }
  hset(key: string, values: Record<string, string | number>) {
    return this.command<number>('HSET', key, ...Object.entries(values).flat());
  }
  hdel(key: string, field: string) { return this.command<number>('HDEL', key, field); }
  hincrby(key: string, field: string, value: number) { return this.command<number>('HINCRBY', key, field, value); }
  incrby(key: string, value: number) { return this.command<number>('INCRBY', key, value); }
  eval<T = unknown>(script: string, keys: string[], args: (string | number)[] = []) {
    return this.command<T>('EVAL', script, keys.length, ...keys, ...args);
  }
  async quit() { if (this.tcp) await this.tcp.quit(); }
}
export const redisClient = new RedisClient();
export async function closeRedisConnection() { await redisClient.quit(); }
@Global()
@Module({ providers: [{ provide: REDIS_CLIENT, useValue: redisClient }], exports: [REDIS_CLIENT] })
export class RedisModule {}
