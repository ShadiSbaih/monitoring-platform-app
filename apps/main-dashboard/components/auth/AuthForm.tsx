"use client";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Mode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password"
  | "verify-email";

export function AuthForm({ mode }: { mode: Mode }) {
  const search = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const title = {
    "sign-in": "Welcome back",
    "sign-up": "Create your free account",
    "forgot-password": "Reset your password",
    "reset-password": "Choose a new password",
    "verify-email": "Verify your email",
  }[mode];
  async function submit(formElement: HTMLFormElement, resend = false) {
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");
    const token = search.get("token") ?? "";
    const action = resend
      ? "resend-verification"
      : mode === "sign-in"
        ? "login"
        : mode === "sign-up"
          ? "signup"
          : mode;
    const body = resend
      ? { email }
      : mode === "verify-email"
        ? { token }
        : mode === "reset-password"
          ? { token, password }
          : mode === "forgot-password"
            ? { email }
            : mode === "sign-up"
              ? { name, email, password }
              : { email, password };
    try {
      const response = await fetch("/api/auth/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          Array.isArray(result.message)
            ? result.message.join(", ")
            : (result.message ?? "Request failed"),
        );
      if (mode === "sign-in" && !resend) {
        await auth.refresh();
        router.replace("/");
        router.refresh();
      } else setMessage(result.message ?? "Check your email.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-8">
        <Link href="/sign-in" className="text-sm font-semibold text-teal-400">
          Tracebloom
        </Link>
        <h1 className="mb-2 mt-6 text-2xl font-semibold">{title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Free log monitoring for your applications.
        </p>
        <form onSubmit={event => { event.preventDefault(); void submit(event.currentTarget); }} className="space-y-4">
          {mode === "sign-up" && (
            <div>
              <label htmlFor="name" className="mb-2 block text-sm">
                Name
              </label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                maxLength={100}
              />
            </div>
          )}
          {["sign-in", "sign-up", "forgot-password"].includes(mode) && (
            <div>
              <label htmlFor="email" className="mb-2 block text-sm">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </div>
          )}
          {["sign-in", "sign-up", "reset-password"].includes(mode) && (
            <div>
              <label htmlFor="password" className="mb-2 block text-sm">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                minLength={mode === "sign-in" ? 1 : 12}
                maxLength={128}
                required
              />
              {mode !== "sign-in" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  At least 12 characters.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-teal-400">
              {message}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait..."
              : mode === "sign-in"
                ? "Sign in"
                : mode === "sign-up"
                  ? "Create account"
                  : mode === "verify-email"
                    ? "Verify email"
                    : mode === "reset-password"
                      ? "Save password"
                      : "Send recovery link"}
          </Button>
          {mode === "sign-in" && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={(event) => {
                const form = event.currentTarget.form;
                const email = form?.elements.namedItem("email") as HTMLInputElement | null;
                if (form && email?.reportValidity()) void submit(form, true);
              }}
            >
              Resend verification email
            </Button>
          )}
        </form>
        <nav className="mt-6 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up">Create account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
        </nav>
      </section>
    </main>
  );
}
