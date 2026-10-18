import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERVER_URI = process.env.NEXT_PUBLIC_SERVER_URI ?? "http://localhost:8080/api/v1";
type RouteContext = { params: Promise<{ types: string[] }> };
const mockAlerts: Array<Record<string, unknown>> = [];

function mockPlan(): string {
  return (process.env.OML_MOCK_PLAN ?? "free").toLowerCase();
}

async function mockBillingResponse(path: string, request: NextRequest): Promise<Response | null> {
  if (path === "billing/current" && request.method === "GET") {
    return NextResponse.json({ plan: mockPlan(), mode: "mock" });
  }
  if (path === "billing/invoices" && request.method === "GET") {
    const now = new Date().toISOString();
    return NextResponse.json([{
      id: "mock-invoice",
      stripe_invoice_id: "in_mock_invoice",
      status: "paid",
      currency: "usd",
      amount_due: 0,
      amount_paid: 0,
      hosted_invoice_url: "/settings",
      invoice_pdf: null,
      created_at: now,
    }]);
  }
  if (path === "billing/checkout" && request.method === "POST") {
    try {
      const body = await request.json() as { selectedPlan?: string };
      return NextResponse.json({ url: `/settings?checkout=mock&plan=${encodeURIComponent(body.selectedPlan ?? "starter")}` });
    } catch {
      return NextResponse.json({ message: "A paid plan must be selected" }, { status: 400 });
    }
  }
  if (path === "billing/portal" && request.method === "POST") {
    if (mockPlan() === "free") return NextResponse.json({ message: "Free plan users do not have a Stripe billing portal yet" }, { status: 400 });
    return NextResponse.json({ url: "/settings?portal=mock" });
  }
  if (path === "alerts" && request.method === "GET") {
    return NextResponse.json(mockAlerts);
  }
  if (path === "alerts" && request.method === "POST") {
    if (mockPlan() === "free") {
      return NextResponse.json({ message: "Alerts are not included in the free plan. Upgrade your plan to start setting up alerts." }, { status: 403 });
    }
    try {
      const body = await request.json() as Record<string, unknown>;
      const threshold = body.threshold && typeof body.threshold === "object" ? body.threshold as { count?: number; window_minutes?: number } : {};
      const rule = {
        ...body,
        threshold: undefined,
        threshold_count: Number(threshold.count ?? 1),
        threshold_window_minutes: Number(threshold.window_minutes ?? 5),
        id: crypto.randomUUID(),
        status: "active",
        last_triggered: null,
        created_at: new Date().toISOString(),
      };
      mockAlerts.unshift(rule);
      return NextResponse.json(rule, { status: 201 });
    } catch {
      return NextResponse.json({ message: "Invalid alert payload" }, { status: 400 });
    }
  }
  if (path.startsWith("alerts/") && request.method === "DELETE") {
    const alertId = decodeURIComponent(path.slice("alerts/".length));
    const index = mockAlerts.findIndex((alert) => alert.id === alertId);
    if (index >= 0) mockAlerts.splice(index, 1);
    return NextResponse.json({ deleted: index >= 0 });
  }
  if (path === "alerts/verify-webhook" && request.method === "POST") {
    if (mockPlan() === "free") return NextResponse.json({ message: "Webhook verification is not included in the free plan." }, { status: 403 });
    return NextResponse.json({ valid: true, mode: "mock" });
  }
  return null;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const { types } = await context.params;
  const pathname = types.map((part) => encodeURIComponent(part)).join("/");

  if (process.env.OML_MOCK_DATA === "true" || !process.env.CLERK_SECRET_KEY) {
    return await mockBillingResponse(pathname, request) ?? NextResponse.json({ message: "Mock endpoint is not configured" }, { status: 503 });
  }

  const { isAuthenticated, getToken } = await auth();
  if (!isAuthenticated) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const token = await getToken();
  if (!token) return NextResponse.json({ message: "Authentication token unavailable" }, { status: 401 });

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
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
