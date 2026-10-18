import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(), email: text('email').notNull().unique(),
  name: text('name').notNull(), password_hash: text('password_hash').notNull(),
  email_verified: boolean('email_verified').default(false).notNull(),
  token_version: integer('token_version').default(0).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token_hash: text('token_hash').notNull().unique(),
  rotated_at: timestamp('rotated_at', { withTimezone: true }),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index('sessions_user_idx').on(t.user_id)]);
export const emailTokens = pgTable('email_tokens', {
  token_hash: text('token_hash').primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const apiKey = pgTable('api_key', {
  id: uuid('id').primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  prefix: text('prefix').notNull(), value: text('value').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, t => [index('api_key_user_idx').on(t.user_id)]);
export const usage = pgTable('usage', {
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  events_used: bigint('events_used', { mode: 'number' }).default(0).notNull(),
}, t => [primaryKey({ columns: [t.user_id, t.day] })]);
export interface AlertCondition { field: string; operator: string; value: string }
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), app_name: text('app_name').notNull(),
  conditions: jsonb('conditions').$type<AlertCondition[]>().notNull(),
  threshold_count: integer('threshold_count').notNull(),
  threshold_window_minutes: integer('threshold_window_minutes').notNull(),
  webhook_url: text('webhook_url').notNull(), cooldown_period: text('cooldown_period').notNull(),
  summary: text('summary').notNull(), status: text('status').default('active').notNull(),
  last_triggered: timestamp('last_triggered', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [index('alerts_user_idx').on(t.user_id)]);
export const ingestBatches = pgTable('ingest_batches', {
  id: text('id').primaryKey(), user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const logEvents = pgTable('log_events', {
  id: text('id').primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key_id: text('key_id').notNull(), type: text('type').notNull(),
  message: text('message').notNull(), app_name: text('app_name').notNull(),
  environment: text('environment').notNull(), importance: text('importance'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  ingested_at: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [index('logs_user_time_idx').on(t.user_id, t.timestamp, t.id),
  index('logs_retention_idx').on(t.ingested_at)]);
export const alertOutbox = pgTable('alert_outbox', {
  id: text('id').primaryKey(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  dispatched_at: timestamp('dispatched_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const alertDeliveries = pgTable('alert_deliveries', {
  id: text('id').primaryKey(), alert_id: uuid('alert_id').notNull().references(() => alerts.id, { onDelete: 'cascade' }),
  delivered_at: timestamp('delivered_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
