"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStream, type StreamLogEntry } from "@tracebloom/next";
import { Activity, Pause, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const levelClasses: Record<string, string> = {
  error: "text-red-400 bg-red-500/10",
  warn: "text-amber-300 bg-amber-500/10",
  info: "text-sky-300 bg-sky-500/10",
};

function displayTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour12: false });
}

export default function LiveLogsPage() {
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const filters = useMemo(() => ({ type: type || undefined, search: search || undefined }), [type, search]);
  const stream = getStream(filters);

  useEffect(() => {
    if (autoScroll && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [autoScroll, stream.data]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Activity className="size-4" /> Observability / Live logs</div>
          <h1 className="text-3xl font-semibold tracking-tight">Live logs</h1>
          <p className="mt-2 text-sm text-muted-foreground">Watch incoming events as they reach your workspace.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className={`size-2 rounded-full ${stream.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
          {stream.connected ? "Connected" : stream.isLoading ? "Connecting" : "Disconnected"}
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" aria-label="Search log messages" placeholder="Search messages" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="h-9 rounded-md border bg-background px-3 text-sm" aria-label="Filter log type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All levels</option><option value="error">Error</option><option value="warn">Warning</option><option value="info">Info</option>
        </select>
        <Button variant="outline" onClick={() => setAutoScroll((current) => !current)}>
          {autoScroll ? <Pause className="mr-2 size-4" /> : <Play className="mr-2 size-4" />}
          Auto-scroll {autoScroll ? "on" : "off"}
        </Button>
        <span className="text-sm text-muted-foreground">{stream.data.length.toLocaleString()} events</span>
      </section>

      {stream.error && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">{stream.error.message} Retrying automatically…</p>}
      <section ref={listRef} aria-label="Live log events" className="max-h-[65vh] min-h-80 overflow-auto rounded-xl border bg-card font-mono text-sm">
        {stream.data.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <Activity className="size-7 opacity-50" />
            <p>{stream.isLoading ? "Connecting to the log stream…" : "Waiting for matching log events"}</p>
          </div>
        ) : stream.data.map((log: StreamLogEntry) => (
          <article key={log.id} className="grid gap-2 border-b px-4 py-3 last:border-0 md:grid-cols-[90px_70px_150px_minmax(0,1fr)] md:items-start">
            <time className="text-xs text-muted-foreground">{displayTime(log.timestamp)}</time>
            <span className={`w-fit rounded px-2 py-0.5 text-xs uppercase ${levelClasses[log.level] ?? levelClasses.info}`}>{log.level}</span>
            <span className="truncate text-xs text-muted-foreground">{String(log.app_name ?? log.service ?? "application")}</span>
            <div className="min-w-0"><p className="break-words text-foreground">{log.message}</p><details className="mt-1 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Details</summary><pre className="mt-2 overflow-auto rounded bg-background p-3">{JSON.stringify(log, null, 2)}</pre></details></div>
          </article>
        ))}
      </section>
    </main>
  );
}
