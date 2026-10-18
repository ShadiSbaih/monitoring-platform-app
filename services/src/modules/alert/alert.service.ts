import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  DRIZZLE_DB,
  PLAN_DEFAULTS,
  REDIS_CLIENT,
  PlanTier,
  REDIS_KEYS,
  normalizePlanTier,
} from '../../configs';
import type { DrizzleDatabase } from '../../database/client';
import { alerts, type AlertCondition } from '../../database/schema';
import type { CreateAlertDto, VerifyWebhookDto } from './alert.dto';

type AlertRecord = typeof alerts.$inferSelect;

@Injectable()
export class AlertService {
  private readonly mockAlerts = new Map<string, AlertRecord[]>();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async createAlert(userId: string, userPlan: unknown, payload: CreateAlertDto): Promise<AlertRecord> {
    const plan = normalizePlanTier(userPlan);
    if (plan === PlanTier.FREE) {
      throw new ForbiddenException('Alerts are not included in the free plan. Upgrade your plan to start setting up alerts.');
    }
    this.validateCreateAlertPayload(payload);

    const limit = PLAN_DEFAULTS[plan].maxAlerts;
    let existing: AlertRecord[];
    if (process.env.DATABASE_URL) {
      existing = await this.db.select().from(alerts).where(eq(alerts.user_id, userId));
    } else {
      existing = this.mockAlerts.get(userId) ?? [];
    }
    if (existing.filter((alert) => alert.status === 'active').length >= limit) {
      throw new ForbiddenException(`Your ${plan} plan supports up to ${limit} active alerts.`);
    }

    const values = {
      user_id: userId,
      name: payload.name.trim(),
      app_name: payload.app_name.trim(),
      conditions: payload.conditions.map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value.trim(),
      })) as AlertCondition[],
      threshold_count: payload.threshold.count,
      threshold_window_minutes: payload.threshold.window_minutes,
      webhook_url: payload.webhook_url.trim(),
      cooldown_period: payload.cooldown_period.trim(),
      summary: payload.summary.trim(),
      status: 'active',
    };

    let created: AlertRecord;
    if (process.env.DATABASE_URL) {
      const [record] = await this.db.insert(alerts).values(values).returning();
      if (!record) throw new BadRequestException('Unable to create alert rule');
      created = record;
    } else {
      created = {
        ...values,
        id: randomUUID(),
        last_triggered: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.mockAlerts.set(userId, [...existing, created]);
    }

    await this.redis.del(REDIS_KEYS.alerts(userId));
    return created;
  }

  async listAlerts(userId: string): Promise<AlertRecord[]> {
    const cacheKey = REDIS_KEYS.alerts(userId);
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      try {
        const parsed = JSON.parse(cached) as AlertRecord[];
        if (Array.isArray(parsed)) return parsed;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const rules = process.env.DATABASE_URL
      ? await this.db.select().from(alerts).where(eq(alerts.user_id, userId)).orderBy(desc(alerts.created_at))
      : [...(this.mockAlerts.get(userId) ?? [])].sort((left, right) => right.created_at.getTime() - left.created_at.getTime());

    // Alert rules are intentionally persistent in Redis. The JetStream consumer reads this key only.
    await this.redis.set(cacheKey, JSON.stringify(rules));
    return rules;
  }

  async deleteAlert(userId: string, alertId: string): Promise<{ deleted: boolean }> {
    let deleted = false;
    if (process.env.DATABASE_URL) {
      const result = await this.db.delete(alerts)
        .where(and(eq(alerts.user_id, userId), eq(alerts.id, alertId)))
        .returning({ id: alerts.id });
      deleted = result.length > 0;
    } else {
      const existing = this.mockAlerts.get(userId) ?? [];
      const remaining = existing.filter((alert) => alert.id !== alertId);
      deleted = remaining.length !== existing.length;
      this.mockAlerts.set(userId, remaining);
    }
    await this.redis.del(REDIS_KEYS.alerts(userId));
    return { deleted };
  }

  verifyWebhook(userPlan: unknown, input: VerifyWebhookDto): { valid: true; mode?: 'mock' } {
    if (normalizePlanTier(userPlan) === PlanTier.FREE) {
      throw new ForbiddenException('Webhook verification is not included in the free plan.');
    }
    if (typeof input.timestamp !== 'number' || !Number.isFinite(input.timestamp)) {
      throw new BadRequestException('Timestamp must be a number');
    }
    if (Math.abs(Date.now() - input.timestamp) > 60_000) {
      throw new BadRequestException('Webhook has expired');
    }
    if (typeof input.signature !== 'string' || !input.signature.trim()) {
      throw new BadRequestException('Signature is required');
    }

    const secret = process.env.WEBHOOK_SIGNING_SECRET;
    if (!secret || secret.includes('replace-with-')) return { valid: true, mode: 'mock' };
    const body = input.body as unknown;
    if (typeof body !== 'string' && (!body || typeof body !== 'object' || Array.isArray(body))) {
      throw new BadRequestException('Webhook body must be a string or JSON object');
    }
    const payloadString = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = createHmac('sha256', secret).update(`${input.timestamp}.${payloadString}`).digest();
    const providedHex = input.signature.replace(/^sha256=/i, '');
    if (!/^[a-f\d]{64}$/i.test(providedHex)) throw new UnauthorizedException('Invalid webhook signature');
    const provided = Buffer.from(providedHex, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return { valid: true };
  }

  private validateCreateAlertPayload(payload: CreateAlertDto): void {
    for (const [field, value] of Object.entries({
      name: payload.name,
      app_name: payload.app_name,
      webhook_url: payload.webhook_url,
      cooldown_period: payload.cooldown_period,
      summary: payload.summary,
    })) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(`${field} is required`);
      }
    }

    let webhook: URL;
    try {
      webhook = new URL(payload.webhook_url);
    } catch {
      throw new BadRequestException('webhook_url must be a valid URL');
    }
    if (webhook.protocol !== 'http:' && webhook.protocol !== 'https:') {
      throw new BadRequestException('webhook_url must use HTTP or HTTPS');
    }
    if (!Array.isArray(payload.conditions) || payload.conditions.length === 0) {
      throw new BadRequestException('At least one alert condition is required');
    }

    const allowedFields = new Set(['type', 'message', 'importance', 'environment', 'service', 'subsystem', 'operation']);
    const allowedOperators = new Set(['equals', 'not_equals']);
    const importanceValues = new Set(['critical', 'high', 'medium', 'low']);
    for (const condition of payload.conditions) {
      if (!allowedFields.has(condition.field)) throw new BadRequestException(`Unsupported alert condition field: ${condition.field}`);
      if (!allowedOperators.has(condition.operator)) throw new BadRequestException(`Unsupported alert operator: ${condition.operator}`);
      if (typeof condition.value !== 'string' || condition.value.trim().length === 0) {
        throw new BadRequestException('Condition values cannot be empty');
      }
      if (condition.field === 'importance' && !importanceValues.has(condition.value.toLowerCase())) {
        throw new BadRequestException('Importance must be critical, high, medium, or low');
      }
    }

    const { count, window_minutes: windowMinutes } = payload.threshold ?? {};
    if (!Number.isInteger(count) || count < 1) throw new BadRequestException('threshold.count must be an integer of at least 1');
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1) {
      throw new BadRequestException('threshold.window_minutes must be an integer of at least 1');
    }
    if (!/^\d+[smhd]$/i.test(payload.cooldown_period.trim())) {
      throw new BadRequestException('cooldown_period must use seconds, minutes, hours, or days (for example 5m)');
    }
  }
}
