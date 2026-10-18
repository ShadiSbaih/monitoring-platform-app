import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../guards/auth.guard';
import { UsageGuard } from '../../guards/usage.guard';
import { LogsService } from './logs.service';
import { SendLogsDto } from './send-logs.dto';
@Controller('logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}
  @Post('send') @UseGuards(AuthGuard, UsageGuard)
  send(@Req() req: { user: { id: string; keyId?: string } }, @Body() body: SendLogsDto) {
    return this.logs.sendLogs(req.user.keyId ?? 'dashboard', req.user.id, body.logs, body.batchId);
  }
  @Get() @UseGuards(AuthGuard)
  get(@Req() req: { user: { id: string } }, @Query() query: Record<string, unknown>) { return this.logs.getLogs(req.user.id, query); }
  @Get('dashboard') @UseGuards(AuthGuard)
  dashboard(@Req() req: { user: { id: string } }) { return this.logs.getLogs(req.user.id, { range: '24h', limit: 5_000 }); }
  @Get('stream') @UseGuards(AuthGuard)
  stream(@Req() req: { user: { id: string } }, @Query() query: Record<string, unknown>, @Res() response: Response) {
    return this.logs.startSse(response, req.user.id, query);
  }
  @Get('metrics/stream') @UseGuards(AuthGuard)
  metrics(@Req() req: { user: { id: string } }, @Res() response: Response) { return this.logs.streamMetricsSse(response, req.user.id); }
  @Get('usage') @UseGuards(AuthGuard)
  usage(@Req() req: { user: { id: string } }) { return this.logs.getUsage(req.user.id); }
}
