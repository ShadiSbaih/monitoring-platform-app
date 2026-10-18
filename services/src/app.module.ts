import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './infra/cache.module';
import { InfrastructureBootstrap } from './infra/infrastructure-bootstrap';
import { RedisModule } from './infra/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';
import { LogsModule } from './modules/logs/logs.module';
import { GuardsModule } from './guards/guards.module';
import { AlertModule } from './modules/alert/alert.module';
@Controller('health')
class HealthController { @Get() health() { return { status: 'ok' }; } }
@Module({ controllers: [HealthController], imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, CacheModule,
  RedisModule, AuthModule, GuardsModule, ApiKeyModule, LogsModule, AlertModule],
  providers: [InfrastructureBootstrap] })
export class AppModule {}
