import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PLAN_DEFAULTS, PlanTier, normalizePlanTier } from '../../configs';
import { AuthGuard } from '../../guards/auth.guard';
import { UsageGuard } from '../../guards/usage.guard';
import { LogsService } from './logs.service';
import { SendLogsDto } from './send-logs.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; keyId?: string };
  plan?: PlanTier;
}

@Controller('logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Post('send')
  @UseGuards(AuthGuard, UsageGuard)
  sendLogs(@Req() request: AuthenticatedRequest, @Body() body: SendLogsDto) {
    const plan = normalizePlanTier(request.plan);
    const maxBatchSize = PLAN_DEFAULTS[plan].maxBatchSize;
    if (maxBatchSize !== null && body.logs.length > maxBatchSize) {
      throw new BadRequestException('Too many logs in one batch');
    }

    return this.logsService.sendLogs(
      request.user.keyId ?? 'dashboard',
      request.user.id,
      body.logs,
      Date.now(),
    );
  }

  @Get()
  @UseGuards(AuthGuard)
  getLogs(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.logsService.getLogs(request.user.id, query);
  }

  @Get('dashboard')
  @UseGuards(AuthGuard)
  getDashboardLogs(@Req() request: AuthenticatedRequest) {
    return this.logsService.getDashboardLogs(request.user.id);
  }

  @Get('stream')
  @UseGuards(AuthGuard)
  async startSse(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    await this.logsService.startSse(response, request.user.id, query);
  }

  @Get('metrics/stream')
  @UseGuards(AuthGuard)
  async streamMetrics(@Res() response: Response): Promise<void> {
    await this.logsService.streamMetricsSse(response);
  }
}
