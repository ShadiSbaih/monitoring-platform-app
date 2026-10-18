import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERVER_URI = process.env.NEXT_PUBLIC_SERVER_URI ?? "http://localhost:8080/api/v1";

function sampleLogs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    type: "error",
    importance: "critical",
    app_name: "oneminutelogs",
    environment: "development",
    subsystem: "api",
    operation: "test.ingest",
    message: `Sample critical error ${index + 1}: test log ingestion`,
    timestamp: new Date().toISOString(),
  }));
}

export async function POST(request: NextRequest) {
  let count = 5;
  try {
    const body = await request.json() as { count?: unknown };
    if (typeof body.count === "number" && Number.isFinite(body.count)) {
      count = Math.max(1, Math.min(100, Math.floor(body.count)));
    }
  } catch {
    // An empty request body uses the five-log smoke-test batch.
  }

  const logs = sampleLogs(count);

  // Local development can exercise the dashboard without provisioning Clerk or Neon.
  if (process.env.OML_MOCK_DATA === "true" || !process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ accepted: logs.length, queued: false, mode: "mock", logs });
  }

  const { isAuthenticated, getToken } = await auth();
  const token = isAuthenticated ? await getToken() : null;
  if (!token) return NextResponse.json({ message: "Authentication required" }, { status: 401 });

  try {
    const upstream = await fetch(`${SERVER_URI.replace(/\/$/, "")}/logs/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ logs }),
      cache: "no-store",
      signal: request.signal,
    });
    const payload = await upstream.json().catch(() => ({}));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json({ accepted: logs.length, queued: false, mode: "mock", logs });
  }
}
