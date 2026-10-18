import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { closeClickHouse } from '../clickhouse/client';
import { createLogsTable } from '../clickhouse/schema';
import { closeDatabase } from '../database/client';
import { closeNatsConnection } from './nats';
import { initNatsStream } from './nats/init-stream';
import { closeRedisConnection } from './redis.module';
import { startWorkers } from './start-workers';

@Injectable()
export class InfrastructureBootstrap implements OnApplicationBootstrap, OnApplicationShutdown {
  async onApplicationBootstrap(): Promise<void> {
    await createLogsTable();
    await initNatsStream();
    await startWorkers();
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([
      closeClickHouse(),
      closeDatabase(),
      closeNatsConnection(),
      closeRedisConnection(),
    ]);
  }
}
