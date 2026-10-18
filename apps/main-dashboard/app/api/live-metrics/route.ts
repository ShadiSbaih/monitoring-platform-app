import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SERVER_URI = process.env.NEXT_PUBLIC_SERVER_URI ?? "http://localhost:8080/api/v1";

function mockMetricsStream(): Response {
  const encoder = new TextEncoder();
  let tick = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        const metrics = {
          ingestRate: 36 + (tick % 9) * 4,
          avgLatency: 14 + (tick % 5) * 2,
          backlog: tick % 4,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(metrics)}\n\n`));
        tick += 1;
      };
      send();
      interval = setInterval(send, 1_000);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(request: NextRequest) {
  if (process.env.OML_MOCK_DATA === "true" || !process.env.CLERK_SECRET_KEY) return mockMetricsStream();

  const { isAuthenticated, getToken } = await auth();
  if (!isAuthenticated) return NextResponse.json({ message: "Authentication required" }, { status: 401 });
  const token = await getToken();
  if (!token) return NextResponse.json({ message: "Authentication token unavailable" }, { status: 401 });

  try {
    const upstream = await fetch(`${SERVER_URI.replace(/\/$/, "")}/logs/metrics/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      cache: "no-store",
      signal: request.signal,
    });
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return NextResponse.json({ message: "The logs service is unavailable" }, { status: 503 });
  }
}
