import { OML_FLUSH_INTERVAL_MS, OML_SERVER_URI } from '../configs/index.js';
import type { LogFilters, LogInput, LoggerConfig, LogPayload, VerifyWebhookOptions } from '../types/index.js';
const transports = new Set<OMLTransport>();
let hooksInstalled = false;
function installHooks() {
  if (hooksInstalled || typeof process === 'undefined') return;
  hooksInstalled = true;
  process.on('beforeExit', () => { for (const transport of transports) void transport.flush(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void Promise.allSettled([...transports].map(transport => transport.close())).finally(() => {
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }
}
export class OMLTransport {
  private readonly apiKey: string;
  private readonly appName: string;
  private readonly environment: string;
  private readonly baseUrl: string;
  private readonly config: LoggerConfig;
  private buffer: LogPayload[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private activeFlush?: Promise<void>;
  private closed = false;
  private pausedUntil = 0;
  constructor(config: LoggerConfig) {
    if (!config.apiKey) throw new Error('A Tracebloom API key is required.');
    this.config = config;
    this.apiKey = config.apiKey;
    this.appName = config.appName || 'default';
    this.environment = config.environment || (typeof process === 'undefined' ? 'production' : process.env.NODE_ENV) || 'development';
    this.baseUrl = (config.baseUrl || (typeof process === 'undefined' ? undefined : process.env.TRACEBLOOM_SERVER_URI) || OML_SERVER_URI).replace(/\/$/, '');
    transports.add(this); installHooks();
  }
  private report(message: string, dropped: number) {
    const error = new Error(message);
    if (this.config.onError) this.config.onError(error, { dropped });
    else console.error('[Tracebloom]', message, { dropped });
  }
  send(payload: LogInput) {
    if (this.closed) { this.report('Logger is closed', 1); return; }
    if (this.buffer.length >= (this.config.maxBufferSize ?? 1_000)) { this.report('Log buffer is full', 1); return; }
    const log = { ...payload, type: payload.type || 'info', app_name: payload.app_name || this.appName,
      environment: payload.environment || this.environment, timestamp: payload.timestamp || new Date().toISOString() } as LogPayload;
    try {
      if (new TextEncoder().encode(JSON.stringify(log)).length > 8_192) { this.report('Log exceeds 8 KiB', 1); return; }
    } catch { this.report('Log is not JSON serializable', 1); return; }
    this.buffer.push(log); this.schedule();
  }
  private schedule() {
    if (this.timer || this.closed || !this.buffer.length) return;
    const delay = Math.max(this.config.flushIntervalMs ?? OML_FLUSH_INTERVAL_MS, this.pausedUntil - Date.now());
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
    this.timer.unref?.();
  }
  flush(): Promise<void> {
    if (this.activeFlush) return this.activeFlush;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.buffer.length) return Promise.resolve();
    if (Date.now() < this.pausedUntil) { this.schedule(); return Promise.resolve(); }
    this.activeFlush = this.drain().finally(() => { this.activeFlush = undefined; this.schedule(); });
    return this.activeFlush;
  }
  private async drain() {
    while (this.buffer.length && Date.now() >= this.pausedUntil) {
      const logs: LogPayload[] = [];
      let bytes = 2;
      const maxBatch = Math.max(1, Math.min(100, this.config.maxBatchSize ?? 100));
      while (this.buffer.length && logs.length < maxBatch) {
        const size = new TextEncoder().encode(JSON.stringify(this.buffer[0])).length + 1;
        if (logs.length && bytes + size > 240_000) break;
        logs.push(this.buffer.shift()!); bytes += size;
      }
      const batchId = globalThis.crypto.randomUUID();
      let success = false;
      let failure = 'Log delivery failed';
      const attempts = Math.max(1, Math.min(6, (this.config.maxRetries ?? 4) + 1));
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await fetch(this.baseUrl + '/logs/send', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
            body: JSON.stringify({ batchId, logs }), signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 15_000) });
          if (response.ok) { success = true; break; }
          failure = 'Log ingestion returned HTTP ' + response.status;
          if (response.status === 429) {
            const info = await response.json().catch(() => ({})) as { retryAfter?: number };
            const seconds = Number(response.headers.get('Retry-After') ?? info.retryAfter ?? 60);
            this.pausedUntil = Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1_000;
            break;
          }
          await response.body?.cancel();
          if (response.status >= 400 && response.status < 500 && response.status !== 408) break;
        } catch (cause) { failure = cause instanceof Error ? cause.message : 'Network request failed'; }
        if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt) + Math.floor(Math.random() * 200)));
      }
      if (!success) this.report(failure, logs.length);
    }
  }
  async close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
    if (this.buffer.length) { this.report('Logger closed with undelivered logs after a usage limit', this.buffer.length); this.buffer = []; }
    transports.delete(this);
  }
  async get<T = unknown>(filters: LogFilters = {}): Promise<T> {
    const response = await fetch(this.baseUrl + '/logs?' + this.query(filters), {
      headers: { 'x-api-key': this.apiKey }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Log query returned HTTP ' + response.status);
    return response.json() as Promise<T>;
  }
  stream(filters: LogFilters = {}): ReadableStream<Uint8Array> {
    const abort = new AbortController();
    const url = this.baseUrl + '/logs/stream?' + this.query(filters);
    const apiKey = this.apiKey;
    return new ReadableStream({
      async start(controller) {
        try {
          const response = await fetch(url, { headers: { 'x-api-key': apiKey, Accept: 'text/event-stream' }, signal: abort.signal });
          if (!response.ok || !response.body) throw new Error('Log stream returned HTTP ' + response.status);
          const reader = response.body.getReader();
          try { while (true) { const chunk = await reader.read(); if (chunk.done) break; controller.enqueue(chunk.value); } controller.close(); }
          finally { reader.releaseLock(); }
        } catch (error) { if (!abort.signal.aborted) controller.error(error); }
      }, cancel() { abort.abort(); },
    });
  }
  async verifyWebhook<T = unknown>(options: VerifyWebhookOptions): Promise<T> {
    const response = await fetch(this.baseUrl + '/alerts/verify-webhook', { method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(options),
      signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Webhook verification returned HTTP ' + response.status);
    return response.json() as Promise<T>;
  }
  private query(filters: LogFilters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    return params.toString();
  }
}
