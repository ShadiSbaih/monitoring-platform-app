import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { UsageGuard } from './usage.guard';

@Global()
@Module({
  providers: [AuthGuard, UsageGuard],
  exports: [AuthGuard, UsageGuard],
})
export class GuardsModule {}
