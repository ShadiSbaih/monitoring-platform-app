import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERVER_URI = process.env.NEXT_PUBLIC_SERVER_URI ?? "http://localhost:8080/api/v1";

function mockLogData() {
  const templates = [
    { type: "info", importance: "low", app_name: "api", service: "gateway", operation: "GET /v1/projects", message: "Projects request completed", environment: "production" },
    { type: "error", importance: "critical", app_name: "billing", service: "payments", operation: "invoice.charge", message: "Payment provider timed out", environment: "production" },
    { type: "warn", importance: "medium", app_name: "worker", service: "queue", operation: "retry.schedule", message: "Job retry scheduled after a transient failure", environment: "production" },
    { type: "info", importance: "low", app_name: "web", service: "frontend", operation: "page.render", message: "Dashboard page rendered", environment: "production" },
    { type: "error", importance: "high", app_name: "api", service: "database", operation: "query.execute", message: "Database query exceeded the latency threshold", environment: "staging" },
    { type: "audit", importance: "low", app_name: "auth", service: "identity", operation: "session.refresh", message: "User session refreshed", environment: "production" },
  ];
  const logs = Array.from({ length: 48 }, (_, index) => ({
    ...templates[index % templates.length],
    timestamp: new Date(Date.now() - index * 29 * 60_000).toISOString(),
    ingested_at: new Date(Date.now() - index * 29 * 60_000).toISOString(),
  }));
  return { logs, totalCount: 2_843, errorCount: 172, mode: "mock" };
}

export async function GET() {
  if (process.env.OML_MOCK_DATA === "true" || !process.env.CLERK_SECRET_KEY) {
    return NextResponse.json(mockLogData(), { headers: { "Cache-Control": "no-store" } });
  }

  const { isAuthenticated, getToken } = await auth();
  if (!isAuthenticated) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const token = await getToken();
  if (!token) return NextResponse.json({ message: "Authentication token unavailable" }, { status: 401 });

  try {
    const response = await fetch(`${SERVER_URI.replace(/\/$/, "")}/logs/dashboard?range=24h`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "The logs service is unavailable" }, { status: 503 });
  }
}
