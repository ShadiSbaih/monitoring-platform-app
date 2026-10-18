import { OMLTransport } from '../utils/index.js';
import type { LogFilters, LogInput, LogPayload, LoggerConfig, VerifyWebhookOptions } from '../types/index.js';

export interface OMLLogger {
  send(payload: LogInput): void;
  info(message: string, fields?: Partial<LogPayload>): void;
  warn(message: string, fields?: Partial<LogPayload>): void;
  error(message: string, fields?: Partial<LogPayload>): void;
  metric(message: string, fields?: Partial<LogPayload>): void;
  audit(message: string, fields?: Partial<LogPayload>): void;
  get<T = unknown>(filters?: LogFilters): Promise<T>;
  stream(filters?: LogFilters): ReadableStream<Uint8Array>;
  verifyWebhook<T = unknown>(options: VerifyWebhookOptions): Promise<T>;
}

export function createLogger(config: LoggerConfig): OMLLogger {
  const appName = config.appName || 'default';
  const environment = config.environment || process.env.NODE_ENV || 'development';
  const transport = new OMLTransport({ ...config, appName, environment });

  const send = (payload: LogInput) =>
    transport.send({ ...payload, app_name: payload.app_name || appName, environment: payload.environment || environment });
  const sendWithType = (type: LogPayload['type']) => (message: string, fields: Partial<LogPayload> = {}) =>
    send({ ...fields, type, message });

  return {
    send,
    info: sendWithType('info'),
    warn: sendWithType('warn'),
    error: sendWithType('error'),
    metric: sendWithType('metric'),
    audit: sendWithType('audit'),
    get: (filters) => transport.get(filters),
    stream: (filters) => transport.stream(filters),
    verifyWebhook: (options) => transport.verifyWebhook(options),
  };
}
