import { NextRequest } from 'next/server';
import { proxyApi } from '@/lib/server-api';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function GET(req: NextRequest) { return proxyApi(req, 'logs/metrics/stream'); }
