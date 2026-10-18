"use client";

import { useCallback, useEffect, useState } from 'react';
import type { LogFilters } from '../types/index.js';

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, unknown>();

function serializeFilters(filters: LogFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.toString();
}

async function fetchLogs(key: string): Promise<unknown> {
  const activeRequest = inFlight.get(key);
  if (activeRequest) return activeRequest;

  const request = fetch(`/api/oneminutelogs/logs?${key}`, { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error(`Log query failed with status ${response.status}`);
    return response.json() as Promise<unknown>;
  });
  inFlight.set(key, request);

  try {
    const data = await request;
    cache.set(key, data);
    return data;
  } finally {
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}

export interface GetLogsResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useLogs<T = unknown>(filters: LogFilters = {}): GetLogsResult<T> {
  const key = serializeFilters(filters);
  const [result, setResult] = useState<{ key: string; data: T } | null>(() =>
    cache.has(key) ? { key, data: cache.get(key) as T } : null,
  );
  const [isLoading, setIsLoading] = useState(() => !cache.has(key));
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const data = await fetchLogs(key) as T;
      setResult({ key, data });
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setIsLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (cache.has(key)) {
      setResult({ key, data: cache.get(key) as T });
      setIsLoading(false);
      return;
    }
    void refetch();
  }, [key, refetch]);

  return {
    data: result?.key === key ? result.data : undefined,
    isLoading,
    error,
    refetch,
  };
}

// The public API name follows the package specification; useLogs remains available
// for consumers and tooling that expect the standard custom-hook naming convention.
export const getLogs = useLogs;
