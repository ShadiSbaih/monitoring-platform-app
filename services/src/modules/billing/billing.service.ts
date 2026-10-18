import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import Stripe from 'stripe';
import { desc, eq, or } from 'drizzle-orm';
import {
  DRIZZLE_DB,
  LRU_CACHE,
  PLAN_DEFAULTS,
  REDIS_CLIENT,
  REDIS_KEYS,
  REDIS_PLAN_TTL_SECONDS,
  PlanTier,
} from '../../configs';
import type { DrizzleDatabase } from '../../database/client';
import { paymentInvoices, plan as planTable, usage as usageTable } from '../../database/schema';
import type Redis from 'ioredis';
import type { LRUCache } from 'lru-cache';

type PaidPlan = PlanTier.STARTER | PlanTier.PRO | PlanTier.BUSINESS;

const planPriceEnv: Record<PaidPlan, string> = {
  [PlanTier.STARTER]: 'STRIPE_STARTER_PRICE_ID',
  [PlanTier.PRO]: 'STRIPE_PRO_PRICE_ID',
  [PlanTier.BUSINESS]: 'STRIPE_BUSINESS_PRICE_ID',
};

@Injectable()
export class BillingService {
  private readonly stripe: Stripe | null;

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(LRU_CACHE) private readonly localCache: LRUCache<string, object>,
  ) {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    this.stripe = stripeSecret && !stripeSecret.includes('replace_me')
      ? new Stripe(stripeSecret)
      : null;
  }

  async getCurrentPlan(userId: string): Promise<PlanTier> {
    const cached = await this.redis.hgetall(REDIS_KEYS.plan(userId));
    if (cached.name) return this.normalizePaidOrFree(cached.name);
    if (!process.env.DATABASE_URL) return PlanTier.FREE;

    const [record] = await this.db
      .select({ name: planTable.name })
      .from(planTable)
      .where(eq(planTable.user_id, userId))
      .limit(1);
    return this.normalizePaidOrFree(record?.name);
  }

  async createBillingSession(userId: string, selectedPlan: unknown): Promise<{ url: string }> {
    if (
      selectedPlan !== PlanTier.STARTER &&
      selectedPlan !== PlanTier.PRO &&
      selectedPlan !== PlanTier.BUSINESS
    ) {
      throw new BadRequestException('Select a paid plan to continue');
    }

    const plan = selectedPlan as PaidPlan;
    const priceId = process.env[planPriceEnv[plan]];
    if (!this.stripe || !priceId || !process.env.CLERK_SECRET_KEY) {
      return { url: `${this.appUrl()}/settings?checkout=mock&plan=${plan}` };
    }

    const customerId = await this.ensureStripeCustomer(userId);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: userId, plan },
      subscription_data: { metadata: { user_id: userId, plan } },
      success_url: `${this.appUrl()}/settings?checkout=success&plan=${plan}`,
      cancel_url: `${this.appUrl()}/settings?checkout=cancelled`,
    });
    if (!session.url) throw new ServiceUnavailableException('Stripe did not return a checkout URL');
    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const currentPlan = await this.getCurrentPlan(userId);
    if (currentPlan === PlanTier.FREE) {
      throw new BadRequestException('Free plan users do not have a Stripe billing portal yet');
    }
    if (!this.stripe || !process.env.CLERK_SECRET_KEY) {
      return { url: `${this.appUrl()}/settings?portal=mock` };
    }

    const customerId = await this.ensureStripeCustomer(userId);
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.appUrl()}/settings`,
    });
    return { url: session.url };
  }

  async getInvoices(userId: string) {
    if (!process.env.DATABASE_URL) {
      const now = new Date();
      return [{
        id: 'mock-invoice',
        user_id: userId,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_invoice_id: 'in_mock_invoice',
        status: 'paid',
        currency: 'usd',
        amount_due: 0,
        amount_paid: 0,
        hosted_invoice_url: `${this.appUrl()}/settings`,
        invoice_pdf: null,
        period_start: now,
        period_end: now,
        created_at: now,
        updated_at: now,
      }];
    }
    return this.db
      .select()
      .from(paymentInvoices)
      .where(eq(paymentInvoices.user_id, userId))
      .orderBy(desc(paymentInvoices.created_at));
  }

  async handleStripeWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!this.stripe || !webhookSecret || webhookSecret.includes('replace_me')) {
      return { received: true, mode: 'mock' as const };
    }
    if (!rawBody || !signature) throw new BadRequestException('Stripe signature and raw request body are required');

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.activatePlanFromCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.activatePlanFromSubscription(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.payment_failed':
      case 'invoice.voided':
        await this.saveInvoice(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.saveInvoice(invoice);
        await this.activatePlanFromInvoice(invoice);
        break;
      }
      default:
        break;
    }

    return { received: true };
  }

  private async activatePlanFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
    const userId = session.metadata?.user_id ?? session.client_reference_id;
    const plan = this.asPaidPlan(session.metadata?.plan);
    const customerId = this.objectId(session.customer);
    if (!userId || !plan || !customerId) return;

    const subscriptionId = this.objectId(session.subscription);
    await this.activatePaidPlan(
      userId,
      plan,
      customerId,
      subscriptionId,
      process.env[planPriceEnv[plan]] ?? null,
    );
  }

  private async activatePlanFromSubscription(subscription: Stripe.Subscription): Promise<void> {
    const customerId = this.objectId(subscription.customer);
    const priceId = subscription.items.data[0]?.price.id ?? null;
    const plan = this.asPaidPlan(subscription.metadata.plan) ?? this.planForPrice(priceId);
    const userId = subscription.metadata.user_id ?? await this.findUserId(subscription.id, customerId);
    if (!userId || !plan || !customerId) return;
    if (subscription.status !== 'active' && subscription.status !== 'trialing') return;

    await this.activatePaidPlan(userId, plan, customerId, subscription.id, priceId);
  }

  private async activatePlanFromInvoice(invoice: Stripe.Invoice): Promise<void> {
    const details = invoice.parent?.subscription_details;
    const subscriptionId = details ? this.objectId(details.subscription) : null;
    const customerId = this.objectId(invoice.customer);
    const metadata = details?.metadata ?? invoice.metadata;
    const userId = metadata?.user_id ?? await this.findUserId(subscriptionId, customerId);
    let plan = this.asPaidPlan(metadata?.plan);

    if (!plan && subscriptionId && process.env.DATABASE_URL) {
      const [existingPlan] = await this.db
        .select({ name: planTable.name, stripe_price_id: planTable.stripe_price_id })
        .from(planTable)
        .where(eq(planTable.stripe_subscription_id, subscriptionId))
        .limit(1);
      plan = this.asPaidPlan(existingPlan?.name) ?? this.planForPrice(existingPlan?.stripe_price_id);
    }
    if (!userId || !plan || !customerId) return;

    await this.activatePaidPlan(
      userId,
      plan,
      customerId,
      subscriptionId,
      process.env[planPriceEnv[plan]] ?? null,
    );
  }

  private async activatePaidPlan(
    userId: string,
    plan: PaidPlan,
    customerId: string,
    subscriptionId: string | null,
    priceId: string | null,
  ): Promise<void> {
    const now = new Date();
    if (process.env.DATABASE_URL) {
      await this.db
        .insert(planTable)
        .values({
          user_id: userId,
          name: plan,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_price_id: priceId,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: planTable.user_id,
          set: {
            name: plan,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            stripe_price_id: priceId,
            updated_at: now,
          },
        });
    }

    const planKey = REDIS_KEYS.plan(userId);
    await this.redis.hset(planKey, {
      name: plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId ?? '',
      stripe_price_id: priceId ?? '',
    });
    await this.redis.expire(planKey, REDIS_PLAN_TTL_SECONDS);
    this.localCache.set(`plan:${userId}`, { name: plan });

    await this.updateUsageSources(userId, PLAN_DEFAULTS[plan].eventsLimit, now);
  }

  private async updateUsageSources(userId: string, eventsLimit: number, now: Date): Promise<void> {
    const usageKey = REDIS_KEYS.usage(userId);
    const cachedUsage = await this.redis.hgetall(usageKey);
    let eventsUsed = Number(cachedUsage.events_used ?? 0);

    if (process.env.DATABASE_URL) {
      const [record] = await this.db
        .select({ events_used: usageTable.events_used })
        .from(usageTable)
        .where(eq(usageTable.user_id, userId))
        .limit(1);
      eventsUsed = Math.max(eventsUsed, Number(record?.events_used ?? 0));
      await this.db
        .insert(usageTable)
        .values({ user_id: userId, events_used: eventsUsed, events_limit: eventsLimit, updated_at: now })
        .onConflictDoNothing();
      await this.db
        .update(usageTable)
        .set({ events_used: eventsUsed, events_limit: eventsLimit, updated_at: now })
        .where(eq(usageTable.user_id, userId));
    }

    await this.redis.hset(usageKey, {
      events_used: String(eventsUsed),
      events_limit: String(eventsLimit),
    });
    await this.redis.expire(usageKey, REDIS_PLAN_TTL_SECONDS);
    this.localCache.set(`usage:${userId}`, { events_used: eventsUsed, events_limit: eventsLimit });
  }

  private async saveInvoice(invoice: Stripe.Invoice): Promise<void> {
    if (!process.env.DATABASE_URL || !invoice.id) return;

    const details = invoice.parent?.subscription_details;
    const subscriptionId = details ? this.objectId(details.subscription) : null;
    const customerId = this.objectId(invoice.customer);
    const userId = details?.metadata?.user_id ?? invoice.metadata?.user_id ??
      await this.findUserId(subscriptionId, customerId);
    if (!userId) return;

    const dateFromUnix = (value: number | null | undefined) => value ? new Date(value * 1_000) : null;
    await this.db
      .insert(paymentInvoices)
      .values({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_invoice_id: invoice.id,
        status: invoice.status ?? 'unknown',
        currency: invoice.currency ?? 'usd',
        amount_due: invoice.amount_due,
        amount_paid: invoice.amount_paid,
        hosted_invoice_url: invoice.hosted_invoice_url ?? null,
        invoice_pdf: invoice.invoice_pdf ?? null,
        period_start: dateFromUnix(invoice.period_start),
        period_end: dateFromUnix(invoice.period_end),
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: paymentInvoices.stripe_invoice_id,
        set: {
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          status: invoice.status ?? 'unknown',
          currency: invoice.currency ?? 'usd',
          amount_due: invoice.amount_due,
          amount_paid: invoice.amount_paid,
          hosted_invoice_url: invoice.hosted_invoice_url ?? null,
          invoice_pdf: invoice.invoice_pdf ?? null,
          period_start: dateFromUnix(invoice.period_start),
          period_end: dateFromUnix(invoice.period_end),
          updated_at: new Date(),
        },
      });
  }

  private async findUserId(subscriptionId: string | null, customerId: string | null): Promise<string | null> {
    if (!process.env.DATABASE_URL || (!subscriptionId && !customerId)) return null;
    const filters = [
      subscriptionId ? eq(planTable.stripe_subscription_id, subscriptionId) : undefined,
      customerId ? eq(planTable.stripe_customer_id, customerId) : undefined,
    ].filter((filter) => filter !== undefined);
    const [record] = await this.db
      .select({ user_id: planTable.user_id })
      .from(planTable)
      .where(or(...filters))
      .limit(1);
    return record?.user_id ?? null;
  }

  private objectId(value: string | { id: string } | null | undefined): string | null {
    if (typeof value === 'string') return value;
    return value?.id ?? null;
  }

  private asPaidPlan(value: unknown): PaidPlan | undefined {
    return value === PlanTier.STARTER || value === PlanTier.PRO || value === PlanTier.BUSINESS
      ? value
      : undefined;
  }

  private planForPrice(priceId: string | null | undefined): PaidPlan | undefined {
    if (!priceId) return undefined;
    return (Object.keys(planPriceEnv) as PaidPlan[]).find((plan) => process.env[planPriceEnv[plan]] === priceId);
  }

  async ensureStripeCustomer(userId: string): Promise<string> {
    if (!this.stripe || !process.env.CLERK_SECRET_KEY) return `cus_mock_${userId}`;

    if (process.env.DATABASE_URL) {
      const [existingPlan] = await this.db
        .select({ stripe_customer_id: planTable.stripe_customer_id })
        .from(planTable)
        .where(eq(planTable.user_id, userId))
        .limit(1);
      if (existingPlan?.stripe_customer_id) return existingPlan.stripe_customer_id;
    }

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const user = await clerk.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) throw new BadRequestException('Add a primary email to your account before billing');

    const existingCustomers = await this.stripe.customers.list({ email, limit: 1 });
    const existingCustomer = existingCustomers.data[0];
    if (existingCustomer) return existingCustomer.id;

    const customer = await this.stripe.customers.create({ email, metadata: { user_id: userId } });
    return customer.id;
  }

  private normalizePaidOrFree(value: unknown): PlanTier {
    if (typeof value !== 'string') return PlanTier.FREE;
    return Object.values(PlanTier).includes(value as PlanTier) ? value as PlanTier : PlanTier.FREE;
  }

  private appUrl(): string {
    return (process.env.APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  }
}
