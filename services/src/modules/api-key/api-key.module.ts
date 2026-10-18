import { Module } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';

@Module({
  controllers: [ApiKeyController],
  providers: [ApiKeyService, AuthGuard],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
