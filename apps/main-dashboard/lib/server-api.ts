import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
const server = () =>
  (
    process.env.SERVER_URI ??
    process.env.NEXT_PUBLIC_SERVER_URI ??
    "http://localhost:8080/api/v1"
  ).replace(/\/$/, "");
type Session = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; email_verified: boolean };
};
const refreshing = new Map<string, Promise<Session | null>>();
export function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  return (
    origin === req.nextUrl.origin &&
    req.headers.get("sec-fetch-site") !== "cross-site"
  );
}
export async function storeSession(session: Session) {
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  jar.set("oml_access", session.accessToken, { ...options, maxAge: 900 });
  jar.set("oml_refresh", session.refreshToken, {
    ...options,
    maxAge: 30 * 86_400,
  });
}
export async function clearSession() {
  const jar = await cookies();
  jar.delete("oml_access");
  jar.delete("oml_refresh");
}
export async function refreshSession(): Promise<Session | null> {
  const token = (await cookies()).get("oml_refresh")?.value;
  if (!token) return null;
  const key = createHash("sha256").update(token).digest("hex");
  let pending = refreshing.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(server() + "/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: token }),
        cache: "no-store",
        signal: AbortSignal.timeout(75_000),
      });
      return response.ok ? (response.json() as Promise<Session>) : null;
    })();
    refreshing.set(key, pending);
    void pending
      .finally(() => {
        const timer = setTimeout(() => refreshing.delete(key), 10_000);
        timer.unref();
      })
      .catch(() => {});
  }
  const session = await pending;
  if (session) await storeSession(session);
  return session;
}
export async function authRequest(req: NextRequest, action: string) {
  if (!checkOrigin(req))
    return NextResponse.json(
      { message: "Invalid request origin" },
      { status: 403 },
    );
  try {
    if (action === "refresh") {
      if (req.method !== "POST")
        return NextResponse.json(
          { message: "Method not allowed" },
          { status: 405 },
        );
      const session = await refreshSession();
      return NextResponse.json(
        session ? { user: session.user } : { message: "Sign in again" },
        { status: session ? 200 : 401 },
      );
    }
    if (action === "me") return proxyApi(req, "auth/me");
    const allowed = [
      "login",
      "signup",
      "logout",
      "forgot-password",
      "reset-password",
      "verify-email",
      "resend-verification",
    ];
    if (!allowed.includes(action) || req.method !== "POST")
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    const body =
      action === "logout"
        ? {
            refreshToken:
              (await cookies()).get("oml_refresh")?.value ??
              "missing-refresh-token-that-is-at-least-32-characters",
          }
        : await req.json();
    const response = await fetch(server() + "/auth/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(75_000),
    });
    const payload = await response.json();
    if (action === "logout") await clearSession();
    if (response.ok && action === "login") {
      await storeSession(payload as Session);
      return NextResponse.json({ user: payload.user });
    }
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      {
        message:
          "The service is waking up or unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
}
export async function proxyApi(
  req: NextRequest,
  path: string,
  options: { method?: string; body?: string } = {},
) {
  if (!checkOrigin(req))
    return NextResponse.json(
      { message: "Invalid request origin" },
      { status: 403 },
    );
  if (!/^[a-zA-Z0-9/_-]+$/.test(path) || path.includes(".."))
    return NextResponse.json({ message: "Invalid path" }, { status: 400 });
  try {
    let token = (await cookies()).get("oml_access")?.value;
    if (!token) token = (await refreshSession())?.accessToken;
    if (!token)
      return NextResponse.json(
        { message: "Authentication required" },
        { status: 401 },
      );
    const method = options.method ?? req.method;
    const body =
      options.body ??
      (!["GET", "HEAD"].includes(method) ? await req.text() : undefined);
    const upstream = () =>
      fetch(server() + "/" + path + req.nextUrl.search, {
        method,
        body,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: path.endsWith("/stream")
            ? "text/event-stream"
            : "application/json",
        },
        cache: "no-store",
        signal: req.signal,
      });
    let response = await upstream();
    if (response.status === 401) {
      await response.body?.cancel();
      token = (await refreshSession())?.accessToken;
      if (!token)
        return NextResponse.json(
          { message: "Authentication required" },
          { status: 401 },
        );
      response = await upstream();
    }
    const headers = new Headers();
    for (const key of [
      "content-type",
      "cache-control",
      "retry-after",
      "x-accel-buffering",
    ]) {
      const value = response.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set("Cache-Control", "no-store, no-transform");
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      {
        message:
          "The service is waking up or unavailable. Please retry shortly.",
      },
      { status: 503 },
    );
  }
}
