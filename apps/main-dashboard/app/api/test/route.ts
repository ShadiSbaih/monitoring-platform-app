import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { proxyApi } from '@/lib/server-api';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const input = await req.json().catch(() => ({})) as { count?: number };
  const count = Math.max(1, Math.min(100, Math.floor(Number(input.count) || 5)));
  const logs = Array.from({ length: count }, (_, i) => ({ type: 'error', importance: 'critical',
    app_name: 'tracebloom', environment: 'development', message: 'Sample critical error ' + (i + 1),
    timestamp: new Date().toISOString() }));
  return proxyApi(req, 'logs/send', { method: 'POST', body: JSON.stringify({ batchId: randomUUID(), logs }) });
}
