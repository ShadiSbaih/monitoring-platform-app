import { NextRequest } from 'next/server';
import { proxyApi } from '@/lib/server-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
async function handle(req: NextRequest, context: { params: Promise<{ types: string[] }> }) {
  const types = (await context.params).types;
  return proxyApi(req, types[0] === 'stream' ? 'logs/stream' : types[0] === 'logs' ? types.join('/') : 'logs');
}
export { handle as GET, handle as POST };
