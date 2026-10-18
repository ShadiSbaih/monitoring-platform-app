"use client";

import { FormEvent, useState } from "react";
import { getLogs } from "@tracebloom/next";
import { Clock3, Loader2, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LogRow = {
  timestamp?: string | number;
  type?: string;
  app_name?: string;
  environment?: string;
  message?: string;
  importance?: number | string;
  subsystem?: string | null;
  operation?: string | null;
  [key: string]: unknown;
};

type QueryResponse = { logs?: LogRow[]; totalCount?: number };

function formatTimestamp(value: LogRow["timestamp"]) {
  if (value === undefined) return "—";
  const date = new Date(typeof value === "number" ? value * 1_000 : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function QueriesPage() {
  const [draft, setDraft] = useState("type:error range:24h limit:100");
  const [query, setQuery] = useState(draft);
  const result = getLogs<QueryResponse>({ query, limit: 100 });
  const logs = Array.isArray(result.data?.logs) ? result.data.logs : [];

  function runQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = draft.trim();
    if (nextQuery === query) void result.refetch();
    else setQuery(nextQuery);
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 lg:p-10">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Search className="size-4" /> Observability / Queries</div>
        <h1 className="text-3xl font-semibold tracking-tight">Log queries</h1>
        <p className="mt-2 text-sm text-muted-foreground">Search historical events with the log query syntax.</p>
      </header>

      <form onSubmit={runQuery} className="rounded-xl border bg-card p-4">
        <label htmlFor="log-query" className="mb-2 block text-sm font-medium">Query</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input id="log-query" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={'type:error env:production app_name:web search:"timeout" range:24h limit:100'} className="h-10 font-mono" />
          <Button type="submit" disabled={result.isLoading} className="sm:min-w-32">
            {result.isLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
            Run query
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Examples: <button type="button" className="font-mono text-primary hover:underline" onClick={() => setDraft("type:error range:24h limit:100")}>type:error</button>, <button type="button" className="font-mono text-primary hover:underline" onClick={() => setDraft("env:production range:1h limit:100")}>env:production</button>, <button type="button" className="font-mono text-primary hover:underline" onClick={() => setDraft('search:"timeout" range:24h limit:100')}>search:"timeout"</button></p>
      </form>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 font-medium"><Clock3 className="size-4 text-muted-foreground" /> Results</div>
          <span className="text-sm text-muted-foreground">{(result.data?.totalCount ?? logs.length).toLocaleString()} events in the last 24 hours</span>
        </div>
        {result.error && <p role="alert" className="m-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive">{result.error.message}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Timestamp</th><th className="px-4 py-3 font-medium">Type</th><th className="px-4 py-3 font-medium">Application</th><th className="px-4 py-3 font-medium">Environment</th><th className="px-4 py-3 font-medium">Message</th></tr></thead>
            <tbody className="divide-y">
              {logs.map((log, index) => (
                <tr key={`${log.timestamp ?? "log"}-${index}`} className="align-top hover:bg-muted/20">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatTimestamp(log.timestamp)}</td>
                  <td className="px-4 py-3"><span className="rounded bg-muted px-2 py-1 text-xs">{log.type ?? "info"}</span></td>
                  <td className="px-4 py-3">{log.app_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{log.environment ?? "—"}</td>
                  <td className="max-w-xl whitespace-normal px-4 py-3">{log.message ?? ""}</td>
                </tr>
              ))}
              {!result.isLoading && logs.length === 0 && <tr><td colSpan={5} className="px-4 py-16 text-center text-muted-foreground">No logs matched this query.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
