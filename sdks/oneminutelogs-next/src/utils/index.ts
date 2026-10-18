import { OML_FLUSH_INTERVAL_MS, OML_SERVER_URI } from '../configs/index.js';
import type { LogFilters, LogInput, LoggerConfig, LogPayload, VerifyWebhookOptions } from '../types/index.js';

export class OMLTransport {
  private readonly apiKey: string;
  private readonly appName: string;
  private readonly environment: string;
  private readonly baseUrl: string;
  private readonly flushInterval = OML_FLUSH_INTERVAL_MS;
  private buffer: LogPayload[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private isFlushing = false;
  private shuttingDown = false;
  private activeFlush: Promise<void> | undefined;

  constructor(config: LoggerConfig) {
    if (!config.apiKey) throw new Error('An OneMinute Logs API key is required.');
    this.apiKey = config.apiKey;
    this.appName = config.appName || 'default';
    this.environment = config.environment || process.env.NODE_ENV || 'development';
    this.baseUrl = (config.baseUrl || process.env.ONEMINUTELOGS_SERVER_URI || OML_SERVER_URI).replace(/\/$/, '');
    this.setupGracefulShutdown();
  }

  send(payload: LogInput): void {
    this.buffer.push({
      ...payload,
      type: payload.type || 'info',
      app_name: payload.app_name || this.appName,
      environment: payload.environment || this.environment,
      timestamp: payload.timestamp || new Date().toISOString(),
      ingested_at: Date.now(),
    } as LogPayload);
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.isFlushing) return this.activeFlush;
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0, this.buffer.length);
    this.isFlushing = true;
    this.activeFlush = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/logs/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'x-oml-app-name': this.appName,
            'x-oml-env': this.environment,
          },
          keepalive: true,
          body: JSON.stringify({ logs: batch }),
        });
        if (!response.ok) throw new Error(`Log ingestion failed with status ${response.status}`);
      } catch (error) {
        this.buffer = [...batch, ...this.buffer];
        if (!this.shuttingDown) console.error('[OneMinute Logs] Batch flush failed:', error);
      } finally {
        this.isFlushing = false;
        this.activeFlush = undefined;
        if (this.buffer.length > 0 && !this.shuttingDown) this.scheduleFlush();
      }
    })();

    return this.activeFlush;
  }

  async get<T = unknown>(filters: LogFilters = {}): Promise<T> {
    const query = this.toQueryString(filters);
    const response = await fetch(`${this.baseUrl}/logs${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: { 'x-api-key': this.apiKey },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Log query failed with status ${response.status}`);
    return response.json() as Promise<T>;
  }

  stream(filters: LogFilters = {}): ReadableStream<Uint8Array> {
    const query = this.toQueryString(filters);
    const abortController = new AbortController();
    const baseUrl = this.baseUrl;
    const apiKey = this.apiKey;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const response = await fetch(`${baseUrl}/logs/stream${query ? `?${query}` : ''}`, {
            method: 'GET',
            headers: { 'x-api-key': apiKey, Accept: 'text/event-stream' },
            cache: 'no-store',
            signal: abortController.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Log stream failed with status ${response.status}`);
          }

          const reader = response.body.getReader();
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          } finally {
            reader.releaseLock();
          }
        } catch (error) {
          if (!abortController.signal.aborted) controller.error(error);
        }
      },
      cancel() {
        abortController.abort();
      },
    });
  }

  async verifyWebhook<T = unknown>(options: VerifyWebhookOptions): Promise<T> {
    const response = await fetch(`${this.baseUrl}/alerts/verify-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify(options),
    });
    if (!response.ok) throw new Error(`Webhook verification failed with status ${response.status}`);
    return response.json() as Promise<T>;
  }

  private toQueryString(filters: LogFilters): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      query.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return query.toString();
  }

  private scheduleFlush(): void {
    if (this.timer || this.shuttingDown) return;
    this.timer = setTimeout(() => void this.flush(), this.flushInterval);
    this.timer.unref?.();
  }

  private setupGracefulShutdown(): void {
    if (typeof process === 'undefined' || typeof process.on !== 'function') return;
    process.on('beforeExit', () => void this.flush());

    const shutdown = () => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      void this.flushOnShutdown().finally(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  private async flushOnShutdown(): Promise<void> {
    if (this.activeFlush) await this.activeFlush;
    if (this.buffer.length > 0) await this.flush();
  }
}
