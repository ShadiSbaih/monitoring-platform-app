"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { OML_MAX_STREAM_LOGS } from '../configs/index.js';
import type { LogFilters, LogLevel, LogPayload } from '../types/index.js';

export interface StreamLogEntry extends LogPayload {
  id: string;
  level: LogLevel;
  timestamp: string;
}

export interface GetStreamResult {
  data: StreamLogEntry[];
  isLoading: boolean;
  error: Error | null;
  connected: boolean;
  disconnect: () => void;
}

function serializeFilters(filters: LogFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.toString();
}

export function toLogEntry(row: Record<string, unknown>): StreamLogEntry {
  const rawType = typeof row.type === 'string' ? row.type.toLowerCase() : 'info';
  const level: LogLevel = rawType === 'error' ? 'error' : rawType === 'warn' ? 'warn' : 'info';
  const rawTimestamp = row.timestamp ?? row.event_time ?? row.eventTime;
  const parsedTimestamp = rawTimestamp instanceof Date
    ? rawTimestamp
    : rawTimestamp === undefined || rawTimestamp === null
      ? new Date()
      : new Date(String(rawTimestamp));
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? new Date().toISOString() : parsedTimestamp.toISOString();
  const id = typeof row.id === 'string' ? row.id : globalThis.crypto.randomUUID();

  return {
    ...row,
    id,
    level,
    timestamp,
    type: rawType as LogPayload['type'],
    message: typeof row.message === 'string' ? row.message : '',
  } as StreamLogEntry;
}

function getRows(payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [payload.logs, payload.data, payload.results, payload.rows];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'));
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const rows = nested.logs ?? nested.data ?? nested.results ?? nested.rows;
      if (Array.isArray(rows)) return rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object'));
    }
  }
  if (payload.log && typeof payload.log === 'object') return [payload.log as Record<string, unknown>];
  if (typeof payload.message === 'string' && payload.type !== 'initial') return [payload];
  return [];
}

export function useLogStream(filters: LogFilters = {}): GetStreamResult {
  const query = serializeFilters(filters);
  const [data, setData] = useState<StreamLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setConnected(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`/api/oneminutelogs/stream?${query}`);
    sourceRef.current = eventSource;
    setData([]);
    setIsLoading(true);
    setError(null);
    setConnected(false);

    eventSource.onopen = () => {
      setConnected(true);
      setIsLoading(false);
      setError(null);
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        const rows = getRows(payload).map(toLogEntry);
        if (payload.type === 'initial') {
          setData(rows.slice(-OML_MAX_STREAM_LOGS));
        } else if (payload.type === 'live') {
          setData((current) => [...current, ...rows].slice(-OML_MAX_STREAM_LOGS));
        }
        setError(null);
        setIsLoading(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error('Unable to read streamed log data.'));
        setIsLoading(false);
      }
    };

    eventSource.onerror = () => {
      setConnected(false);
      setError(new Error('The log stream connection was interrupted.'));
      setIsLoading(false);
    };

    return () => {
      eventSource.close();
      if (sourceRef.current === eventSource) sourceRef.current = null;
    };
  }, [query]);

  return { data, isLoading, error, connected, disconnect };
}

export const getStream = useLogStream;
