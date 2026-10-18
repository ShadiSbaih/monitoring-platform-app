export const PORT = 8080;
export const VERSION = 'v1';

export const LRU_SOFT_TTL_MS = 5 * 60 * 1000;
export const LRU_CACHE_MAX_ENTRIES = 10_000;
export const REDIS_API_KEY_TTL_SECONDS = 10 * 60;
export const REDIS_PLAN_TTL_SECONDS = 6 * 60;
export const PLAN_REDIS_TTL_SECONDS = REDIS_PLAN_TTL_SECONDS;

export const DRIZZLE_DB = 'DRIZZLE_DB';
export const LRU_CACHE = 'LRU_CACHE';
export const REDIS_CLIENT = 'REDIS_CLIENT';

export enum PlanTier {
  FREE = 'free',
  STARTER = 'starter',
  PRO = 'pro',
  BUSINESS = 'business',
}

export interface PlanDefaults {
  eventsLimit: number;
  maxBatchSize: number | null;
  retentionDays: number;
  maxAlerts: number;
}

export const PLAN_DEFAULTS: Readonly<Record<PlanTier, Readonly<PlanDefaults>>> = Object.freeze({
  [PlanTier.FREE]: Object.freeze({
    eventsLimit: 10_000,
    maxBatchSize: 100,
    retentionDays: 7,
    maxAlerts: 0,
  }),
  [PlanTier.STARTER]: Object.freeze({
    eventsLimit: 100_000,
    maxBatchSize: null,
    retentionDays: 30,
    maxAlerts: 5,
  }),
  [PlanTier.PRO]: Object.freeze({
    eventsLimit: 500_000,
    maxBatchSize: null,
    retentionDays: 60,
    maxAlerts: 12,
  }),
  [PlanTier.BUSINESS]: Object.freeze({
    eventsLimit: 1_000_000,
    maxBatchSize: null,
    retentionDays: 90,
    maxAlerts: 20,
  }),
});

export function normalizePlanTier(value: unknown): PlanTier {
  if (typeof value !== 'string') return PlanTier.FREE;

  switch (value.trim().toLowerCase()) {
    case PlanTier.STARTER:
      return PlanTier.STARTER;
    case PlanTier.PRO:
      return PlanTier.PRO;
    case PlanTier.BUSINESS:
      return PlanTier.BUSINESS;
    case PlanTier.FREE:
    default:
      return PlanTier.FREE;
  }
}

export const REDIS_KEYS = Object.freeze({
  apiKey: (keyId: string) => `oml:api_key:${VERSION}:${keyId}`,
  apiKeyLastUsed: `oml:api_key:last_used:${VERSION}`,
  apiKeyLastUsedLock: (keyId: string) => `oml:api_key:last_used_lock:${VERSION}:${keyId}`,
  usage: (userId: string) => `oml:usage:${VERSION}:${userId}`,
  usageDirty: `oml:usage:dirty:${VERSION}`,
  plan: (userId: string) => `oml:plan:${VERSION}:${userId}`,
  hardLock: (userId: string) => `oml:user:${userId}:locked`,
  alerts: (userId: string) => `oml:alerts:${userId}`,
  alertCount: (ruleId: string, bucket: number) => `oml:alert:count:${ruleId}:${bucket}`,
  alertCooldown: (ruleId: string) => `oml:alert:cooldown:${ruleId}`,
  ingestLatency: 'oml:ingest:latency',
  ingestBacklog: 'oml:ingest:backlog',
  ingestRate: 'oml:ingest:last_rate',
  ingestRateBucket: (timestamp: number) => `oml:ingest:rate:${timestamp}`,
});

export const CLICKHOUSE_DATABASE = 'logs';
export const CLICKHOUSE_EVENTS_TABLE = 'logs.events';

export const NATS_STREAM_NAME = 'OML_LOGS';
export const NATS_STREAM_SUBJECTS = ['logs.ingest', 'logs.alert.evaluate'] as const;
