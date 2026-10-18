import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const apiKey = pgTable('api_key', {
  id: uuid('id').primaryKey(),
  user_id: text('user_id').notNull(),
  prefix: text('prefix').notNull(),
  value: text('value').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  last_used_at: timestamp('last_used_at'),
  revoked_at: timestamp('revoked_at'),
});

export const usage = pgTable('usage', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull().unique(),
  events_used: bigint('events_used', { mode: 'number' }).default(0).notNull(),
  events_limit: bigint('events_limit', { mode: 'number' }).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const plan = pgTable('plan', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull().unique(),
  name: text('name').notNull(),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  stripe_price_id: text('stripe_price_id'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const paymentInvoices = pgTable('payment_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull(),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  stripe_invoice_id: text('stripe_invoice_id').notNull().unique(),
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  amount_due: bigint('amount_due', { mode: 'number' }).notNull(),
  amount_paid: bigint('amount_paid', { mode: 'number' }).notNull(),
  hosted_invoice_url: text('hosted_invoice_url'),
  invoice_pdf: text('invoice_pdf'),
  period_start: timestamp('period_start'),
  period_end: timestamp('period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export interface AlertCondition {
  field: string;
  operator: string;
  value: string;
}

export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  app_name: text('app_name').notNull(),
  conditions: jsonb('conditions').$type<AlertCondition[]>().notNull(),
  threshold_count: integer('threshold_count').notNull(),
  threshold_window_minutes: integer('threshold_window_minutes').notNull(),
  webhook_url: text('webhook_url').notNull(),
  cooldown_period: text('cooldown_period').notNull(),
  summary: text('summary').notNull(),
  status: text('status').default('active').notNull(),
  last_triggered: timestamp('last_triggered'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
