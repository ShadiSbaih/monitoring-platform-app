import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { DashboardGuard } from '../../guards/dashboard.guard';
import { AuthGuard } from '../../guards/auth.guard';
import { AlertService } from './alert.service';
import { CreateAlertDto, VerifyWebhookDto } from './alert.dto';
@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertController {
  constructor(private readonly alerts: AlertService) {}
  @Get() @UseGuards(DashboardGuard) list(@Req() req: { user: { id: string } }) { return this.alerts.listAlerts(req.user.id); }
  @Post() @UseGuards(DashboardGuard) create(@Req() req: { user: { id: string } }, @Body() body: CreateAlertDto) { return this.alerts.createAlert(req.user.id, body); }
  @Delete(':id') @UseGuards(DashboardGuard) delete(@Req() req: { user: { id: string } }, @Param('id', ParseUUIDPipe) id: string) { return this.alerts.deleteAlert(req.user.id, id); }
  @Post('verify-webhook') verify(@Req() req: { user: { id: string } }, @Body() body: VerifyWebhookDto) { return this.alerts.verifyWebhook(req.user.id, body); }
}
