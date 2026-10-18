import { NextRequest } from 'next/server';
import { proxyApi } from '@/lib/server-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
async function handle(req: NextRequest, context: { params: Promise<{ types: string[] }> }) {
  return proxyApi(req, (await context.params).types.join('/'));
}
export { handle as GET, handle as POST, handle as DELETE, handle as PATCH };
