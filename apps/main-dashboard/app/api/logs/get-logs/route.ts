import { NextRequest } from 'next/server';
import { proxyApi } from '@/lib/server-api';
export const dynamic = 'force-dynamic';
export function GET(req: NextRequest) { return proxyApi(req, 'logs/dashboard'); }
