import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { clickhouseClient } from '../../clickhouse/client';
import {
  PLAN_DEFAULTS,
  REDIS_CLIENT,
  REDIS_KEYS,
  REDIS_PLAN_TTL_SECONDS,
  PlanTier,
  normalizePlanTier,
} from '../../configs';
import { Inject } from '@nestjs/common';
import { publishLogBatch } from '../../infra/nats/producer';
import { addClient, type SseFilters } from '../../sse/sse-registry';
import type { Response } from 'express';

const QUERY_COOLDOWN_MS = 2_000;
const RESULT_CACHE_TTL_MS = 1_000;
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 10_000;

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
    return Math.floor(value > 2_000_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value !== 'string' || !value.trim()) return fallback;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.floor(numeric > 2_000_000_000_000 ? numeric / 1_000 : numeric);
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
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async sendLogs(keyId: string, userId: string, logs: Record<string, unknown>[], serverReceivedAt: number) {
    try {
      await publishLogBatch(keyId, userId, logs, serverReceivedAt);
      return { accepted: logs.length, queued: true };
    } catch (error) {
      console.error('Unable to publish log batch to NATS', error);
      throw new ServiceUnavailableException('Log ingestion is temporarily unavailable');
    }
  }

  async getLogs(userId: string, queryObj: Record<string, unknown> = {}): Promise<LogsQueryResult> {
    const parsed = this.parseFilters(queryObj);
    const cacheKey = `${userId}:${JSON.stringify(parsed)}`;
    const now = Date.now();
    const cached = resultCache.get(cacheKey);

    if (queryCooldown.has(cacheKey) && cached && now <= cached.expiresAt + QUERY_COOLDOWN_MS) {
      return cached.value;
    }
    if (cached && cached.expiresAt > now) return cached.value;

    queryCooldown.set(cacheKey, true);
    const filters = ['user_id = {userId:String}', 'timestamp >= toDateTime({timestampFrom:UInt32})', 'timestamp <= toDateTime({timestampTo:UInt32})'];
    const queryParams: Record<string, string | number> = {
      userId,
      timestampFrom: parsed.timestampFrom,
      timestampTo: parsed.timestampTo,
      limit: parsed.limit,
      timestamp24h: Math.floor(now / 1_000) - 86_400,
    };

    if (parsed.type) {
      filters.push('type = {type:String}');
      queryParams.type = parsed.type;
    }
    if (parsed.env) {
      filters.push('environment = {environment:String}');
      queryParams.environment = parsed.env;
    }
    if (parsed.appName) {
      filters.push('app_name = {appName:String}');
      queryParams.appName = parsed.appName;
    }
    if (parsed.search) {
      filters.push('positionCaseInsensitive(message, {search:String}) > 0');
      queryParams.search = parsed.search;
    }

    const where = filters.join('\n  AND ');
    const countFilters = filters.filter((filter) => !filter.startsWith('timestamp >=') && !filter.startsWith('timestamp <='));
    countFilters.push('timestamp >= toDateTime({timestamp24h:UInt32})');
    const countQueryParams: Record<string, string | number> = {
      userId,
      timestamp24h: Math.floor(now / 1_000) - 86_400,
    };
    if (parsed.type) countQueryParams.type = parsed.type;
    if (parsed.env) countQueryParams.environment = parsed.env;
    if (parsed.appName) countQueryParams.appName = parsed.appName;
    if (parsed.search) countQueryParams.search = parsed.search;

    try {
      const [rowsResult, countResult] = await Promise.all([
        clickhouseClient.query({
          query: `SELECT key_id, user_id, type, message, app_name, environment, importance, subsystem, service, operation, track, security, metrics, timestamp, ingested_at FROM logs.events WHERE ${where} ORDER BY timestamp DESC LIMIT {limit:UInt32}`,
          query_params: queryParams,
          format: 'JSONEachRow',
        }),
        clickhouseClient.query({
          query: `SELECT count() AS totalCount, countIf(type = 'error') AS errorCount FROM logs.events WHERE ${countFilters.join('\n  AND ')}`,
          query_params: countQueryParams,
          format: 'JSONEachRow',
        }),
      ]);
      const [logs, countRows] = await Promise.all([
        rowsResult.json<Record<string, unknown>>(),
        countResult.json<{ totalCount: string | number; errorCount: string | number }>(),
      ]);
      const result = {
        logs: Array.isArray(logs) ? logs : [],
        totalCount: Number(Array.isArray(countRows) ? countRows[0]?.totalCount ?? 0 : 0),
        errorCount: Number(Array.isArray(countRows) ? countRows[0]?.errorCount ?? 0 : 0),
      };
      resultCache.set(cacheKey, { value: result, expiresAt: Date.now() + RESULT_CACHE_TTL_MS });
      return result;
    } catch (error) {
      console.error('ClickHouse log query failed', error);
      throw new ServiceUnavailableException('Log search is temporarily unavailable');
    }
  }

  async getDashboardLogs(userId: string): Promise<LogsQueryResult> {
    return this.getLogs(userId, { range: '24h', limit: 5_000 });
  }

  async startSse(response: Response, userId: string, queryObj: Record<string, unknown> = {}): Promise<void> {
    const parsed = this.parseFilters({ ...queryObj, limit: queryObj.limit ?? 500 });
    const filters: SseFilters = {
      userId,
      type: parsed.type,
      env: parsed.env,
      appName: parsed.appName,
      search: parsed.search,
    };

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const cleanup = addClient(response, filters);
    const keepAlive = setInterval(() => {
      if (!response.writableEnded && !response.destroyed) response.write(': keep-alive\n\n');
    }, 25_000);
    response.once('close', () => {
      clearInterval(keepAlive);
      cleanup();
    });

    try {
      const initial = await this.getLogs(userId, { ...queryObj, limit: parsed.limit });
      if (!response.writableEnded && !response.destroyed) {
        response.write(`data: ${JSON.stringify({ type: 'initial', logs: initial.logs })}\n\n`);
      }
    } catch (error) {
      clearInterval(keepAlive);
      cleanup();
      response.end(`event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`);
    }
  }

  async streamMetricsSse(response: Response): Promise<void> {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const writeMetrics = async () => {
      const [rate, backlog, latencies] = await Promise.all([
        this.redis.get(REDIS_KEYS.ingestRate),
        this.redis.get(REDIS_KEYS.ingestBacklog),
        this.redis.lrange(REDIS_KEYS.ingestLatency, 0, 59),
      ]);
      const values = latencies.map(Number).filter(Number.isFinite);
      const avgLatency = values.length > 0
        ? values.reduce((total, value) => total + value, 0) / values.length
        : 0;
      response.write(`data: ${JSON.stringify({ ingestRate: Number(rate ?? 0), avgLatency, backlog: Number(backlog ?? 0) })}\n\n`);
    };

    let writing = false;
    const interval = setInterval(() => {
      if (writing || response.writableEnded || response.destroyed) return;
      writing = true;
      void writeMetrics()
        .catch((error) => console.warn('Unable to stream live metrics', error))
        .finally(() => { writing = false; });
    }, 1_000);

    response.once('close', () => clearInterval(interval));
    await writeMetrics();
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
