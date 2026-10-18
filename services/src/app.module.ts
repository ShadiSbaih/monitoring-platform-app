import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './infra/cache.module';
import { InfrastructureBootstrap } from './infra/infrastructure-bootstrap';
import { RedisModule } from './infra/redis.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';
import { LogsModule } from './modules/logs/logs.module';
import { GuardsModule } from './guards/guards.module';
import { UsageDbSync } from './schedulers/usage-db-sync';
import { BillingModule } from './modules/billing/billing.module';
import { AlertModule } from './modules/alert/alert.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    CacheModule,
    RedisModule,
    ApiKeyModule,
    GuardsModule,
    LogsModule,
    BillingModule,
    AlertModule,
  ],
  providers: [InfrastructureBootstrap, UsageDbSync],
})
export class AppModule {}
