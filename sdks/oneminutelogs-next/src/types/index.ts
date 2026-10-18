export type {
  Importance,
  LogFilters,
  LogInput,
  LogLevel,
  LogPayload,
  LogTimestamps,
  LogType,
  Subsystem,
} from './log.js';
export type { LogMetrics } from './metrics.js';
export type { AuthStatus, LogSecurity } from './security.js';
export type { LogTrack, UserRole } from './track.js';

export interface LoggerConfig {
  apiKey: string;
  appName?: string;
  environment?: string;
  baseUrl?: string;
}

export interface VerifyWebhookOptions {
  signature: string;
  timestamp: string | number;
  body: string | Record<string, any>;
}
