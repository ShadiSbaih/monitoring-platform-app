import { createHash, randomUUID } from 'node:crypto';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { FREE_LIMITS, REDIS_KEYS, STREAMS } from '../../configs';
import { changeBacklog, setBacklog } from './telemetry';
import { redisClient } from '../redis.module';

export interface IngestJob {
  batchId: string; userId: string; keyId: string; receivedAt: number; bytes: number;
  logs: Record<string, unknown>[];
}
export const ADMIT_SCRIPT = `
local previous=redis.call('GET',KEYS[1])
if previous then if previous==ARGV[1] then return 0 else return -5 end end
local n=tonumber(ARGV[2]); local bytes=tonumber(ARGV[3])
if tonumber(redis.call('GET',KEYS[2]) or '0')+n>tonumber(ARGV[4]) then return -1 end
if tonumber(redis.call('GET',KEYS[3]) or '0')+n>tonumber(ARGV[5]) then return -2 end
if tonumber(redis.call('GET',KEYS[4]) or '0')+1>tonumber(ARGV[6]) then return -2 end
if tonumber(redis.call('GET',KEYS[5]) or '0')+bytes>tonumber(ARGV[7]) then return -2 end
if tonumber(redis.call('GET',KEYS[6]) or '0')+bytes>tonumber(ARGV[8]) then return -3 end
redis.call('XADD',KEYS[7],'*','payload',ARGV[9])
redis.call('SET',KEYS[1],ARGV[1],'EX',864000)
for i=2,5 do local increment=n; if i==4 then increment=1 elseif i==5 then increment=bytes end
redis.call('INCRBY',KEYS[i],increment); redis.call('EXPIRE',KEYS[i],259200) end
redis.call('INCRBY',KEYS[6],bytes)
return 1
`;
const wakeListeners = new Map<string, () => void>();
export function wakeWorkers(stream?: string) { for (const [key, wake] of wakeListeners) if (!stream || stream === key) wake(); }
export function utcDay(timestamp = Date.now()) { return new Date(timestamp).toISOString().slice(0, 10); }
export async function publishLogBatch(keyId: string, userId: string, logs: Record<string, unknown>[], batchId: string = randomUUID()) {
  if (logs.length < 1 || logs.length > FREE_LIMITS.maxBatchSize) throw new HttpException('Send between 1 and 100 logs per batch', 413);
  if (logs.some(log => Buffer.byteLength(JSON.stringify(log)) > FREE_LIMITS.maxLogBytes)) throw new HttpException('Each log must be at most 8 KiB', 413);
  const logBytes = Buffer.byteLength(JSON.stringify(logs));
  if (logBytes > FREE_LIMITS.maxBatchBytes) throw new HttpException('The log batch is too large', 413);
  const bytes = logBytes + logs.length * 512 + 256;
  const payload: IngestJob = { batchId, userId, keyId, logs, bytes, receivedAt: Date.now() };
  const day = utcDay();
  const hash = createHash('sha256').update(JSON.stringify({ keyId, logs })).digest('hex');
  let result: number;
  try {
    result = await redisClient.eval<number>(ADMIT_SCRIPT, [
      'oml:batch:' + userId + ':' + batchId, REDIS_KEYS.usage(userId, day),
      'oml:budget:events:' + day, 'oml:budget:batches:' + day,
      'oml:budget:bytes:' + day, REDIS_KEYS.queueBytes, STREAMS.ingest,
    ], [hash, logs.length, bytes, FREE_LIMITS.eventsPerDay, FREE_LIMITS.platformEventsPerDay,
      FREE_LIMITS.platformBatchesPerDay, FREE_LIMITS.platformBytesPerDay, FREE_LIMITS.queueMaxBytes, JSON.stringify(payload)]);
  } catch { throw new ServiceUnavailableException('The log queue is temporarily unavailable. Retry this batch later.'); }
  if (result === -5) throw new HttpException('This batch ID was already used for different logs', 409);
  if (result === -3) throw new HttpException('The queue is full. Retry later.', 503);
  if (result < 0) throw new HttpException({
    message: result === -1 ? 'Daily log allowance reached' : 'Shared daily platform allowance reached',
    retryAfter: Math.ceil((Date.parse(utcDay() + 'T00:00:00Z') + 86_400_000 - Date.now()) / 1_000),
  }, 429);
  if (result === 1) changeBacklog(1);
  wakeWorkers(STREAMS.ingest);
  return { accepted: logs.length, queued: true, duplicate: result === 0, batchId };
}
type Entry = [string, string[]];
type StreamResponse = [string, Entry[]][] | null;
const GROUP = 'oml_workers_v1';
let stopping = false;
const timers = new Set<ReturnType<typeof setTimeout>>();
export async function ensureStreams() {
  for (const stream of [STREAMS.ingest, STREAMS.alerts]) {
    try { await redisClient.command('XGROUP', 'CREATE', stream, GROUP, '0', 'MKSTREAM'); }
    catch (error) { if (!(error as Error).message.includes('BUSYGROUP')) throw error; }
  }
  const sizes = await Promise.all([redisClient.command<number>('XLEN', STREAMS.ingest), redisClient.command<number>('XLEN', STREAMS.alerts)]);
  setBacklog(sizes.reduce((a, b) => a + b, 0));
}

const ACK_SCRIPT = `
local ack=redis.call('XACK',KEYS[1],ARGV[1],ARGV[2])
if ack==1 then redis.call('XDEL',KEYS[1],ARGV[2])
if ARGV[4]=='1' and redis.call('EXISTS',KEYS[3])==1 then return ack end
if tonumber(ARGV[3])>0 then local n=redis.call('DECRBY',KEYS[2],ARGV[3]); if n<0 then redis.call('SET',KEYS[2],0) end end end
return ack
`;
export function runConsumer(stream: string, processJob: (payload: Record<string, unknown>) => Promise<void>) {
  const consumer = randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let requested = false;
  let delay = 1_000;
  let lastClaim = 0;
  let claimCursor = '0-0';
  const schedule = (ms: number) => {
    if (timer) { clearTimeout(timer); timers.delete(timer); }
    if (stopping) return;
    timer = setTimeout(() => { if (timer) timers.delete(timer); void tick(); }, ms);
    timer.unref();
    timers.add(timer);
  };
  const handle = async ([id, fields]: Entry) => {
    const raw = fields[fields.indexOf('payload') + 1];
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
      await processJob(payload);
    } catch (error) {
      const pending = await redisClient.command<[string, string, number, number][]>('XPENDING', stream, GROUP, id, id, 1);
      if ((pending[0]?.[3] ?? 1) < 8) { console.warn('Queue job will retry', stream, id); return; }
      await redisClient.command('XADD', STREAMS.dead, 'MAXLEN', '~', 100, '*',
        'stream', stream, 'source_id', id, 'payload', raw, 'error', String((error as Error).message).slice(0, 200));
      await redisClient.command('XTRIM', STREAMS.dead, 'MINID', String(Date.now() - 7 * 86_400_000) + '-0');
      await redisClient.expire(STREAMS.dead, 7 * 86_400);
    }
    const acknowledged = await redisClient.eval<number>(ACK_SCRIPT, [stream, REDIS_KEYS.queueBytes,
      'oml:alert:published:' + String(payload.userId) + ':' + String(payload.batchId)],
      [GROUP, id, Number(payload.bytes ?? 0), stream === STREAMS.ingest ? '1' : '0']);
    if (acknowledged) changeBacklog(-1);
  };
  const tick = async () => {
    if (busy || stopping) { requested = true; return; }
    busy = true;
    requested = false;
    let received = 0;
    try {
      if (Date.now() - lastClaim > 60_000) {
        lastClaim = Date.now();
        const claim = await redisClient.command<[string, Entry[], string[]]>('XAUTOCLAIM', stream, GROUP, consumer, 30_000, claimCursor, 'COUNT', 10);
        claimCursor = claim[0];
        for (const entry of claim[1]) { await handle(entry); received++; }
      }
      const rows = await redisClient.command<StreamResponse>('XREADGROUP', 'GROUP', GROUP, consumer, 'COUNT', 10, 'STREAMS', stream, '>');
      for (const [, entries] of rows ?? []) for (const entry of entries) { await handle(entry); received++; }
      delay = received ? 1_000 : Math.min(delay * 2, 300_000);
    } catch { console.warn('Cloud queue consumer unavailable; retrying'); delay = Math.min(delay * 2, 300_000); }
    finally { busy = false; schedule(requested || received ? 0 : delay); }
  };
  const wake = () => { if (busy) requested = true; else schedule(0); };
  wakeListeners.set(stream, wake);
  schedule(0);
}
export function stopConsumers() {
  stopping = true;
  for (const timer of timers) clearTimeout(timer);
  timers.clear(); wakeListeners.clear();
}
