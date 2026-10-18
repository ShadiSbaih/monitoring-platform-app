import type { Response } from 'express';

export interface SseFilters {
  userId?: string;
  type?: string;
  env?: string;
  appName?: string;
  search?: string;
}

interface SseClient {
  response: Response;
  filters: SseFilters;
}

const clients = new Map<Response, SseClient>();
const BROADCAST_CHUNK_SIZE = 50;

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesFilters(log: Record<string, unknown>, filters: SseFilters): boolean {
  if (filters.userId && log.user_id !== filters.userId) return false;
  if (filters.type && normalize(log.type) !== normalize(filters.type)) return false;
  if (filters.env && normalize(log.environment) !== normalize(filters.env)) return false;
  if (filters.appName && normalize(log.app_name) !== normalize(filters.appName)) return false;
  if (filters.search) {
    const search = normalize(filters.search);
    const message = normalize(log.message);
    if (!message.includes(search)) return false;
  }
  return true;
}

export function addClient(response: Response, filters: SseFilters): () => void {
  const client = { response, filters };
  clients.set(response, client);

  const remove = () => {
    clients.delete(response);
    response.off('close', remove);
    response.off('error', remove);
  };
  response.once('close', remove);
  response.once('error', remove);
  return remove;
}

export function broadcastLogs(logs: Record<string, unknown>[]): void {
  if (logs.length === 0) return;

  for (const client of clients.values()) {
    if (client.response.writableEnded || client.response.destroyed) {
      clients.delete(client.response);
      continue;
    }

    const matchingLogs = logs.filter((log) => matchesFilters(log, client.filters));
    for (let offset = 0; offset < matchingLogs.length; offset += BROADCAST_CHUNK_SIZE) {
      const chunk = matchingLogs.slice(offset, offset + BROADCAST_CHUNK_SIZE);
      try {
        client.response.write(`data: ${JSON.stringify({ type: 'live', logs: chunk })}\n\n`);
      } catch {
        clients.delete(client.response);
      }
    }
  }
}

export function getSseClientCount(): number {
  return clients.size;
}
