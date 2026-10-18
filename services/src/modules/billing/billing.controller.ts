import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlanTier } from '../../configs';
import { AuthGuard } from '../../guards/auth.guard';
import { UsageGuard } from '../../guards/usage.guard';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './billing.dto';

interface BillingRequest extends Request {
  user: { id: string };
  plan?: PlanTier;
  rawBody?: Buffer;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('current')
  @UseGuards(AuthGuard, UsageGuard)
  getCurrentPlan(@Req() request: BillingRequest) {
    return { plan: request.plan ?? PlanTier.FREE };
  }

  @Post('checkout')
  @UseGuards(AuthGuard)
  createBillingSession(@Req() request: BillingRequest, @Body() body: CreateCheckoutDto) {
    return this.billingService.createBillingSession(request.user.id, body.selectedPlan);
  }

  @Post('portal')
  @UseGuards(AuthGuard)
  createPortalSession(@Req() request: BillingRequest) {
    return this.billingService.createPortalSession(request.user.id);
  }

  @Get('invoices')
  @UseGuards(AuthGuard)
  getInvoices(@Req() request: BillingRequest) {
    return this.billingService.getInvoices(request.user.id);
  }

  @Post('webhook')
  @HttpCode(201)
  handleStripeWebhook(
    @Req() request: BillingRequest,
    @Headers('stripe-signature') signature?: string,
  ) {
    return this.billingService.handleStripeWebhook(request.rawBody, signature);
  }
}
