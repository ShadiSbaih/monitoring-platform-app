import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlanTier } from '../../configs';
import { AuthGuard } from '../../guards/auth.guard';
import { UsageGuard } from '../../guards/usage.guard';
import { AlertService } from './alert.service';
import { CreateAlertDto, VerifyWebhookDto } from './alert.dto';

interface AlertRequest extends Request {
  user: { id: string };
  plan?: PlanTier;
}

@Controller('alerts')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  @Get()
  @UseGuards(AuthGuard)
  listAlerts(@Req() request: AlertRequest) {
    return this.alertService.listAlerts(request.user.id);
  }

  @Post()
  @UseGuards(AuthGuard, UsageGuard)
  createAlert(@Req() request: AlertRequest, @Body() body: CreateAlertDto) {
    return this.alertService.createAlert(request.user.id, request.plan, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  deleteAlert(@Req() request: AlertRequest, @Param('id') alertId: string) {
    return this.alertService.deleteAlert(request.user.id, alertId);
  }

  @Post('verify-webhook')
  @UseGuards(AuthGuard, UsageGuard)
  verifyWebhook(@Req() request: AlertRequest, @Body() body: VerifyWebhookDto) {
    return this.alertService.verifyWebhook(request.plan, body);
  }
}
