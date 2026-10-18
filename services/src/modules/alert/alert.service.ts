import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DB, FREE_LIMITS, REDIS_CLIENT, REDIS_KEYS } from '../../configs';
import type { DrizzleDatabase } from '../../database/client';
import { alerts } from '../../database/schema';
import { RedisClient } from '../../infra/redis.module';
import { validateWebhookUrl } from '../../utils/webhook';
import type { CreateAlertDto, VerifyWebhookDto } from './alert.dto';
@Injectable()
export class AlertService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}
  async createAlert(userId: string, payload: CreateAlertDto) {
    try { validateWebhookUrl(payload.webhook_url); } catch { throw new BadRequestException('Use a public HTTPS webhook URL on port 443'); }
    if (!/^([1-9]\d*)(s|m|h|d)$/.test(payload.cooldown_period) || payload.threshold.window_minutes > 1_440
      || payload.conditions.length > 10) throw new BadRequestException('Invalid alert window, cooldown or condition count');
    const created = await this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const existing = await tx.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.user_id, userId), eq(alerts.status, 'active')));
      if (existing.length >= FREE_LIMITS.maxAlerts) throw new ForbiddenException('You can have up to 3 active alerts');
      const [rule] = await tx.insert(alerts).values({
        user_id: userId, name: payload.name.trim(), app_name: payload.app_name.trim(),
        conditions: payload.conditions, threshold_count: payload.threshold.count,
        threshold_window_minutes: payload.threshold.window_minutes, webhook_url: payload.webhook_url.trim(),
        cooldown_period: payload.cooldown_period, summary: payload.summary.trim(),
      }).returning();
      return rule;
    });
    await this.redis.del(REDIS_KEYS.alerts(userId));
    await this.listAlerts(userId);
    return created;
  }
  async listAlerts(userId: string) {
    const rules = await this.db.select().from(alerts).where(eq(alerts.user_id, userId)).orderBy(desc(alerts.created_at));
    await this.redis.set(REDIS_KEYS.alerts(userId), JSON.stringify(rules));
    return rules;
  }
  async deleteAlert(userId: string, id: string) {
    const deleted = await this.db.delete(alerts).where(and(eq(alerts.user_id, userId), eq(alerts.id, id))).returning({ id: alerts.id });
    await this.redis.del(REDIS_KEYS.alerts(userId));
    await this.listAlerts(userId);
    return { deleted: deleted.length > 0 };
  }
  async verifyWebhook(userId: string, input: VerifyWebhookDto) {
    if (Math.abs(Date.now() - input.timestamp) > 60_000) throw new BadRequestException('Webhook has expired');
    const secret = process.env.WEBHOOK_SIGNING_SECRET;
    if (!secret) throw new UnauthorizedException('Webhook verification unavailable');
    const raw = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    const expected = createHmac('sha256', secret).update(input.timestamp + '.' + raw).digest();
    const hex = input.signature.replace(/^sha256=/, '');
    if (!/^[a-f0-9]{64}$/i.test(hex) || !timingSafeEqual(expected, Buffer.from(hex, 'hex'))) throw new UnauthorizedException('Invalid webhook signature');
    let payload: { alert_id?: string };
    try { payload = JSON.parse(raw); } catch { throw new UnauthorizedException('Invalid webhook payload'); }
    if (!payload.alert_id || !/^[0-9a-f-]{36}$/i.test(payload.alert_id)) throw new UnauthorizedException('Invalid webhook payload');
    const [owner] = await this.db.select({ id: alerts.id }).from(alerts)
      .where(and(eq(alerts.id, payload.alert_id), eq(alerts.user_id, userId))).limit(1);
    if (!owner) throw new UnauthorizedException('Webhook belongs to another account');
    return { valid: true };
  }
}
