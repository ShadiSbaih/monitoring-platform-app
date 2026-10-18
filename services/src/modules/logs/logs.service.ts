import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import type { Response } from 'express';
import { DRIZZLE_DB, FREE_LIMITS, REDIS_CLIENT, REDIS_KEYS } from '../../configs';
import type { DrizzleDatabase } from '../../database/client';
import { logEvents, usage } from '../../database/schema';
import { RedisClient } from '../../infra/redis.module';
import { publishLogBatch, utcDay } from '../../infra/streams/queue';
import { getTelemetry, getBacklog } from '../../infra/streams/telemetry';
import { addClient } from '../../sse/sse-registry';

const QUERY_COOLDOWN_MS = 2_000;
const RESULT_CACHE_TTL_MS = 1_000;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 5_000;

const queryCooldown = new LRUCache<string, true>({ max: 10_000, ttl: QUERY_COOLDOWN_MS });
const resultCache = new LRUCache<string, { value: LogsQueryResult; expiresAt: number }>({ max: 10_000 });

interface ParsedFilters {
  type?: string;
  env?: string;
  appName?: string;
  search?: string;
  limit: number;
  timestampFrom: number;
  timestampTo: number;
}

export interface LogsQueryResult {
  logs: Record<string, unknown>[];
  totalCount: number;
  errorCount?: number;
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseUnixTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 1_000_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value !== 'string' || !value.trim()) return fallback;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric > 1_000_000_000_000 ? numeric / 1_000 : numeric);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : fallback;
}

function relativeRangeSeconds(value: string): number {
  const match = value.trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60;
  const amount = Number(match[1]);
  const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3_600, d: 86_400 };
  return amount * unitSeconds[match[2]];
}

function parseDsl(dsl: string, output: Record<string, unknown>): void {
  const tokens = dsl.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const separator = token.indexOf(':');
    if (separator <= 0) continue;
    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1).replace(/^"|"$/g, '');
    switch (key) {
      case 'type':
      case 'env':
      case 'environment':
      case 'app_name':
      case 'appname':
      case 'app':
      case 'search':
      case 'message':
      case 'range':
      case 'from':
      case 'to':
      case 'limit':
        output[key] = value;
        break;
    }
  }
}

@Injectable()
export class LogsService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}
  sendLogs(keyId: string, userId: string, logs: Record<string, unknown>[], batchId?: string) {
    return publishLogBatch(keyId, userId, logs, batchId);
  }
  async getUsage(userId: string) {
    const day = utcDay();
    const accepted = Number(await this.redis.get(REDIS_KEYS.usage(userId, day)) ?? 0);
    const [stored] = await this.db.select().from(usage).where(and(eq(usage.user_id, userId), eq(usage.day, day))).limit(1);
    return { day, events_used: accepted, events_stored: stored?.events_used ?? 0, events_limit: FREE_LIMITS.eventsPerDay,
      remaining: Math.max(0, FREE_LIMITS.eventsPerDay - accepted), retention_days: FREE_LIMITS.retentionDays,
      max_alerts: FREE_LIMITS.maxAlerts, max_api_keys: FREE_LIMITS.maxApiKeys, max_batch_size: FREE_LIMITS.maxBatchSize,
      platform_events_limit: FREE_LIMITS.platformEventsPerDay };
  }
  async getLogs(userId: string, query: Record<string, unknown>): Promise<LogsQueryResult> {
    const parsed = this.parseFilters(query);
    const key = JSON.stringify([userId, parsed]);
    const cached = resultCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const filters = [eq(logEvents.user_id, userId),
      gte(logEvents.ingested_at, new Date(Date.now() - FREE_LIMITS.retentionDays * 86_400_000))];
    if (parsed.type) filters.push(eq(logEvents.type, parsed.type));
    if (parsed.env) filters.push(eq(logEvents.environment, parsed.env));
    if (parsed.appName) filters.push(eq(logEvents.app_name, parsed.appName));
    if (parsed.search) filters.push(ilike(logEvents.message, '%' + parsed.search.replace(/[\\%_]/g, '\\$&') + '%'));
    try {
      const [rows, counts] = await Promise.all([
        this.db.select().from(logEvents).where(and(...filters,
          gte(logEvents.timestamp, new Date(parsed.timestampFrom * 1_000)),
          lte(logEvents.timestamp, new Date(parsed.timestampTo * 1_000))))
          .orderBy(desc(logEvents.timestamp), desc(logEvents.id)).limit(parsed.limit),
        this.db.select({ totalCount: sql<number>`count(*)::int`,
          errorCount: sql<number>`count(*) filter (where ${logEvents.type} = 'error')::int` })
          .from(logEvents).where(and(...filters, gte(logEvents.timestamp, new Date(Date.now() - 86_400_000)))),
      ]);
      const result = { logs: rows.map(row => ({ ...row.payload, ...row, payload: undefined })),
        totalCount: counts[0]?.totalCount ?? 0, errorCount: counts[0]?.errorCount ?? 0 };
      resultCache.set(key, { value: result, expiresAt: Date.now() + RESULT_CACHE_TTL_MS });
      return result;
    } catch { throw new ServiceUnavailableException('Log search is temporarily unavailable'); }
  }
  async startSse(response: Response, userId: string, query: Record<string, unknown> = {}) {
    const parsed = this.parseFilters({ ...query, limit: query.limit ?? 500 });
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    // Register before the initial query to avoid missing concurrent inserts.
    const cleanup = addClient(response, { userId, type: parsed.type, env: parsed.env, appName: parsed.appName, search: parsed.search });
    const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 20_000);
    const expiry = setTimeout(() => response.end(), 240_000);
    response.once('close', () => { clearInterval(heartbeat); clearTimeout(expiry); cleanup(); });
    try {
      const initial = await this.getLogs(userId, { ...query, limit: parsed.limit });
      if (!response.destroyed) response.write('data: ' + JSON.stringify({ type: 'initial', logs: initial.logs }) + '\n\n');
    } catch { response.end('event: error\ndata: {"message":"Log search unavailable"}\n\n'); }
  }
  async streamMetricsSse(response: Response, userId: string) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.flushHeaders();
    const write = () => response.write('data: ' + JSON.stringify({ ...getTelemetry(userId), backlog: getBacklog() }) + '\n\n');
    write();
    const interval = setInterval(write, 5_000);
    const expiry = setTimeout(() => response.end(), 240_000);
    response.once('close', () => { clearInterval(interval); clearTimeout(expiry); });
  }
  private parseFilters(queryObj: Record<string, unknown>): ParsedFilters {
    const values: Record<string, unknown> = { ...queryObj };
    const dsl = queryObj.query ?? queryObj.q;
    if (typeof dsl === 'string') parseDsl(dsl, values);

    const nowSeconds = Math.floor(Date.now() / 1_000);
    const range = typeof values.range === 'string' ? values.range : '30d';
    const rangeSeconds = relativeRangeSeconds(range);
    const timestampTo = parseUnixTimestamp(values.to, nowSeconds);
    const timestampFrom = parseUnixTimestamp(values.from, timestampTo - rangeSeconds);
    const requestedLimit = Number(values.limit ?? DEFAULT_QUERY_LIMIT);

    const appNameValue = values.app_name ?? values.appname ?? values.app;
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), MAX_QUERY_LIMIT))
      : DEFAULT_QUERY_LIMIT;

    return {
      type: typeof values.type === 'string' && values.type ? values.type.trim() : undefined,
      env: typeof (values.env ?? values.environment) === 'string'
        ? String(values.env ?? values.environment).trim() || undefined
        : undefined,
      appName: typeof appNameValue === 'string' ? appNameValue.trim() || undefined : undefined,
      search: typeof (values.search ?? values.message) === 'string'
        ? String(values.search ?? values.message).trim() || undefined
        : undefined,
      limit,
      timestampFrom: Math.max(0, timestampFrom),
      timestampTo: Math.max(timestampFrom, timestampTo),
    };
  }
}
