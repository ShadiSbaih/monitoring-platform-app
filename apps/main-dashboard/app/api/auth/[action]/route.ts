import { NextRequest } from 'next/server';
import { authRequest } from '@/lib/server-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
async function handle(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  return authRequest(req, (await context.params).action);
}
export { handle as GET, handle as POST };
