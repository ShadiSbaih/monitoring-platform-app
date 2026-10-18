import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERVER_URI = process.env.NEXT_PUBLIC_SERVER_URI ?? "http://localhost:8080/api/v1";

type RouteContext = { params: Promise<{ types: string[] }> };

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { isAuthenticated, getToken } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  }

  const token = await getToken();
  if (!token) return NextResponse.json({ message: "Authentication token unavailable" }, { status: 401 });

  const { types } = await context.params;
  const pathname = types.map((part) => encodeURIComponent(part)).join("/");
  const target = new URL(`${SERVER_URI.replace(/\/$/, "")}/${pathname}`);
  target.search = request.nextUrl.search;

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    Accept: request.headers.get("accept") ?? "application/json",
  });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const method = request.method;
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  try {
    const upstream = await fetch(target, { method, headers, body, cache: "no-store", signal: request.signal });
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control", "content-disposition", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ message: "The logs service is unavailable" }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
