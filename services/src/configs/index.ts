export const PORT = 8080;
export const VERSION = 'v1';
export const DRIZZLE_DB = 'DRIZZLE_DB';
export const LRU_CACHE = 'LRU_CACHE';
export const REDIS_CLIENT = 'REDIS_CLIENT';
export const LRU_SOFT_TTL_MS = 60_000;
export const LRU_CACHE_MAX_ENTRIES = 2_000;
export const REDIS_API_KEY_TTL_SECONDS = 600;
export function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
  return value;
}
export const FREE_LIMITS = Object.freeze({
  eventsPerDay: positiveInt('OML_EVENTS_PER_USER_DAY', 1_000),
  retentionDays: 7, maxAlerts: 3, maxApiKeys: 3, maxBatchSize: 100,
  maxLogBytes: 8_192, maxBatchBytes: 262_144,
  platformEventsPerDay: positiveInt('OML_PLATFORM_EVENTS_DAY', 5_000),
  platformBatchesPerDay: positiveInt('OML_PLATFORM_BATCHES_DAY', 750),
  platformBytesPerDay: positiveInt('OML_PLATFORM_BYTES_DAY', 33_554_432),
  queueMaxBytes: positiveInt('OML_QUEUE_MAX_BYTES', 67_108_864),
});
export const STREAMS = {
  ingest: 'oml:logs:ingest:v1', alerts: 'oml:logs:alerts:v1', dead: 'oml:jobs:dead:v1',
};
export const REDIS_KEYS = {
  apiKey: (id: string) => 'oml:api_key:v1:' + id,
  apiKeyLastUsed: 'oml:api_key:last_used:v1',
  apiKeyLastUsedLock: (id: string) => 'oml:api_key:last_used_lock:v1:' + id,
  alerts: (id: string) => 'oml:alerts:' + id,
  hardLock: (id: string) => 'oml:user:' + id + ':locked',
  usage: (id: string, day = new Date().toISOString().slice(0, 10)) => 'oml:usage:v2:' + day + ':' + id,
  queueBytes: 'oml:queue:bytes:v1',
};
