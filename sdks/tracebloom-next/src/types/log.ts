import type { LogMetrics } from './metrics.js';
import type { LogSecurity } from './security.js';
import type { LogTrack } from './track.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogType = 'error' | 'warn' | 'info' | 'audit' | 'metric' | 'debug' | 'success';
export type Importance = 'critical' | 'high' | 'medium' | 'low';
export type Subsystem =
  | 'auth'
  | 'db'
  | 'api'
  | 'payment'
  | 'cache'
  | 'queue'
  | 'worker'
  | 'ui'
  | 'other'
  | (string & {});

export interface LogTimestamps {
  event_time: string;
  ingest_time?: string;
}

export interface LogPayload {
  type: LogType;
  message: string;
  importance?: Importance;
  app_name?: string;
  environment?: string;
  subsystem?: Subsystem;
  service?: string;
  operation?: string;
  track?: LogTrack;
  security?: LogSecurity;
  metrics?: LogMetrics;
  timestamps?: LogTimestamps;
  timestamp?: string;
  ingested_at?: number;
  [key: string]: unknown;
}

export type LogInput = Omit<Partial<LogPayload>, 'message'> & { message: string };

export interface LogFilters {
  [key: string]: string | number | boolean | readonly (string | number)[] | null | undefined;
}
