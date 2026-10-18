"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDemoAuth } from "./demo-auth-provider";

type DemoAuthPageProps = { mode: "sign-in" | "sign-up" };

export function DemoAuthPage({ mode }: DemoAuthPageProps) {
  const isSignUp = mode === "sign-up";
  const router = useRouter();
  const { signIn, signUp } = useDemoAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");

  const finishDemoSignIn = (nextEmail: string, nextName?: string) => {
    signIn(nextEmail, nextName);
    router.push("/");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSignUp) {
      signUp(name, email, organization);
      router.push("/");
      return;
    }
    finishDemoSignIn(email);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#020202] px-4 py-12 text-slate-100">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(to_right,#1f1f1f_1px,transparent_1px),linear-gradient(to_bottom,#1f1f1f_1px,transparent_1px)] bg-size-[4rem_4rem] opacity-20 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"
      />
      <section className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-[#0A0A0A]/90 p-8 shadow-2xl shadow-emerald-950/20 backdrop-blur-xl sm:p-10">
        <Link href="/" className="mb-8 inline-flex text-sm text-slate-400 hover:text-white">
          ← Back to OneMinute Logs
        </Link>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Demo authentication
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Clerk keys are not configured yet. This local preview stores a demo identity in this browser only.
        </p>

        <button
          type="button"
          onClick={() => finishDemoSignIn("alex@demo.oneminutelogs.dev", "Alex Morgan")}
          className="mt-7 flex w-full items-center justify-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
        >
          <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-white text-xs font-bold text-slate-900">
            G
          </span>
          Continue with Google (demo)
        </button>

        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-600">
          <span className="h-px flex-1 bg-white/10" />
          or continue with email
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          {isSignUp && (
            <label className="block text-sm text-slate-300">
              Full name
              <input
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60"
                placeholder="Alex Morgan"
              />
            </label>
          )}
          <label className="block text-sm text-slate-300">
            Email address
            <input
              autoComplete="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60"
              placeholder="you@company.com"
            />
          </label>
          {isSignUp && (
            <label className="block text-sm text-slate-300">
              Organization
              <input
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-400/60"
                placeholder="Acme Inc."
              />
            </label>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-200"
          >
            {isSignUp ? "Create demo account" : "Continue with email (demo)"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          {isSignUp ? "Already have an account?" : "New to OneMinute Logs?"}{" "}
          <Link
            href={isSignUp ? "/sign-in" : "/sign-up"}
            className="font-medium text-emerald-300 hover:text-emerald-200"
          >
            {isSignUp ? "Sign in" : "Get started"}
          </Link>
        </p>
      </section>
    </main>
  );
}
