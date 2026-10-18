import { NextRequest, NextResponse } from 'next/server';
export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith('/api/') || ['/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/verify-email'].includes(path)) return NextResponse.next();
  if (!req.cookies.has('oml_access') && !req.cookies.has('oml_refresh')) return NextResponse.redirect(new URL('/sign-in', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|woff2?)$).*)'] };
