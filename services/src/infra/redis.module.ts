import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../configs';

export const redisClient = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB ?? 0),
  retryStrategy: (attempt) => {
    if (attempt > 3) return null;
    return Math.min(250 * 2 ** (attempt - 1), 2_000);
  },
});

redisClient.on('ready', () => console.info('Redis connected'));
redisClient.on('error', (error) => console.error('Redis connection error', error));

export async function closeRedisConnection(): Promise<void> {
  if (redisClient.status === 'end') return;
  await redisClient.quit();
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useValue: redisClient,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
