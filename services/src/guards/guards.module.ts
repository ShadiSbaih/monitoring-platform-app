import { Global, Module } from '@nestjs/common';
import { DashboardGuard } from './dashboard.guard';
import { AuthGuard } from './auth.guard';
import { UsageGuard } from './usage.guard';

@Global()
@Module({
  providers: [AuthGuard, UsageGuard, DashboardGuard],
  exports: [AuthGuard, UsageGuard, DashboardGuard],
})
export class GuardsModule {}
