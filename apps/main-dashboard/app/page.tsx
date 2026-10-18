"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format } from "timeago.js";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Clock3,
  Radio,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAlerts, type AlertRule } from "@/lib/alerts-api";

type LogRow = {
  timestamp?: string | number;
  ingested_at?: string | number;
  type?: string;
  app_name?: string;
  appName?: string;
  environment?: string;
  service?: string;
  subsystem?: string;
  operation?: string;
  message?: string;
};

type LogsResponse = {
  logs: LogRow[];
  totalCount: number;
  errorCount?: number;
};

type LiveMetrics = { ingestRate: number; avgLatency: number; backlog: number };

async function fetchOverviewLogs(): Promise<LogsResponse> {
  const response = await fetch("/api/logs/get-logs", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load log metrics (${response.status})`);
  return response.json() as Promise<LogsResponse>;
}

function timestampDate(log: LogRow): Date | null {
  const value = log.timestamp ?? log.ingested_at;
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    const date = new Date(value > 2_000_000_000_000 ? value : value * 1_000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value.includes(" ") ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compactRate(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k/s` : `${Math.round(value)}/s`;
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "No trigger yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No trigger yet" : format(date);
}

function topAlertTime(alert: AlertRule): string {
  return alert.last_triggered ?? alert.created_at;
}

export default function OverviewPage() {
  const logsQuery = useQuery({ queryKey: ["overview-logs-24h"], queryFn: fetchOverviewLogs, refetchInterval: 30_000 });
  const alertsQuery = useQuery({ queryKey: ["alerts"], queryFn: fetchAlerts, refetchInterval: 30_000 });
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [metricsConnected, setMetricsConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/live-metrics");
    source.onopen = () => setMetricsConnected(true);
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as Partial<LiveMetrics>;
        if (typeof next.ingestRate === "number" && typeof next.avgLatency === "number" && typeof next.backlog === "number") {
          setMetrics({ ingestRate: next.ingestRate, avgLatency: next.avgLatency, backlog: next.backlog });
          setMetricsConnected(true);
        }
      } catch {
        // Ignore malformed heartbeats and keep the EventSource connection open.
      }
    };
    source.onerror = () => setMetricsConnected(false);
    return () => {
      source.close();
      setMetricsConnected(false);
    };
  }, []);

  const data = logsQuery.data;
  const logs = data?.logs ?? [];
  const alerts = alertsQuery.data ?? [];
  const logMetrics = useMemo(() => {
    const now = new Date();
    const hours = Array.from({ length: 24 }, (_, index) => {
      const hourDate = new Date(now.getTime() - (23 - index) * 60 * 60 * 1_000);
      const key = Math.floor(hourDate.getTime() / 3_600_000);
      return {
        key,
        hour: hourDate.toLocaleTimeString([], { hour: "2-digit", hour12: false }),
        logs: 0,
        errors: 0,
      };
    });
    const bucketMap = new Map(hours.map((bucket) => [bucket.key, bucket]));
    const sourceCounts = new Map<string, number>();

    for (const log of logs) {
      const date = timestampDate(log);
      if (date) {
        const bucket = bucketMap.get(Math.floor(date.getTime() / 3_600_000));
        if (bucket) {
          bucket.logs += 1;
          if (log.type?.toLowerCase() === "error") bucket.errors += 1;
        }
      }
      const source = log.service || log.app_name || log.appName || log.subsystem;
      if (source) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }

    const total = Number(data?.totalCount ?? logs.length);
    const errorCount = Number(data?.errorCount ?? logs.filter((log) => log.type?.toLowerCase() === "error").length);
    const errorRate = total > 0 ? `${((errorCount / total) * 100).toFixed(1)}%` : "0.0%";
    const topSources = [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
    const topActivity = [...logs]
      .sort((left, right) => (timestampDate(right)?.getTime() ?? 0) - (timestampDate(left)?.getTime() ?? 0))
      .slice(0, 16)
      .map((log) => {
        const date = timestampDate(log);
        const type = log.type?.toLowerCase() ?? "info";
        return {
          time: date?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) ?? "—",
          source: log.subsystem || log.app_name || log.appName || log.service || "application",
          action: log.operation || log.message || "Log event",
          type,
        };
      });

    return { hours, total, errorCount, errorRate, topSources, topActivity };
  }, [data, logs]);

  const activeAlerts = alerts.filter((alert) => alert.status === "active").length;
  const recentAlerts = [...alerts]
    .sort((left, right) => new Date(topAlertTime(right)).getTime() - new Date(topAlertTime(left)).getTime())
    .slice(0, 4);

  const stats = [
    { label: "24h Logs Count", value: logsQuery.isLoading ? "Loading…" : logMetrics.total.toLocaleString(), icon: Activity, live: false },
    { label: "Error Rate", value: logsQuery.isLoading ? "Loading…" : logMetrics.errorRate, icon: AlertTriangle, live: false },
    { label: "Ingest Rate", value: metrics ? compactRate(metrics.ingestRate) : "Connecting…", icon: Radio, live: true },
    { label: "Active Alerts", value: alertsQuery.isLoading ? "Loading…" : activeAlerts.toLocaleString(), icon: Bell, live: false },
    { label: "Average Latency", value: metrics ? `${metrics.avgLatency.toFixed(1)} ms` : "Connecting…", icon: Clock3, live: true },
    { label: "Queue Backlog", value: metrics ? `${metrics.backlog.toLocaleString()} jobs` : "Connecting…", icon: TrendingUp, live: true },
  ];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Workspace / Overview</p>
          <h1 className="text-3xl font-semibold tracking-tight">System overview</h1>
          <p className="mt-2 text-sm text-muted-foreground">Log volume, errors, and ingest health over the last 24 hours.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${metricsConnected ? "bg-emerald-400" : "bg-amber-400"}`} />{metricsConnected ? "Live telemetry connected" : "Connecting to telemetry"}</div>
      </header>

      {logsQuery.error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{logsQuery.error.message}</p>}
      {alertsQuery.error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{alertsQuery.error.message}</p>}

      <section aria-label="24 hour system metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {stats.map(({ label, value, icon: Icon, live }) => <Card key={label}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle><Icon className="size-4 text-muted-foreground" /></CardHeader>
          <CardContent><p className="text-xl font-semibold">{value}</p>{live && <p className="mt-1 text-xs text-muted-foreground">{metricsConnected ? "Live" : "Waiting for stream"}</p>}</CardContent>
        </Card>)}
      </section>

      <section aria-label="Log charts and sources" className="grid gap-5 lg:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-sm">Logs Over Time · 24h</CardTitle></CardHeader>
          <CardContent className="h-64 min-w-0">
            {logsQuery.isLoading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading log activity…</div> : logMetrics.hours.some((hour) => hour.logs > 0) ? <ResponsiveContainer width="100%" height="100%">
              <LineChart data={logMetrics.hours} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={5} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                <ChartTooltip contentStyle={{ borderRadius: 10 }} />
                <Line type="monotone" dataKey="logs" name="Logs" stroke="#00C2A8" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No logs in this period.</div>}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-sm">Error Trend · 24h</CardTitle></CardHeader>
          <CardContent className="h-64 min-w-0">
            {logsQuery.isLoading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading error activity…</div> : logMetrics.hours.some((hour) => hour.errors > 0) ? <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={logMetrics.hours} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={5} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
                <ChartTooltip contentStyle={{ borderRadius: 10 }} />
                <Area type="monotone" dataKey="errors" name="Errors" stroke="#f87171" fill="#f87171" fillOpacity={0.18} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No errors in this period.</div>}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-sm">Top Sources · 24h</CardTitle></CardHeader>
          <CardContent className="h-64 min-w-0">
            {logsQuery.isLoading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading sources…</div> : logMetrics.topSources.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={logMetrics.topSources} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="source" width={75} tick={{ fontSize: 10 }} />
                <ChartTooltip contentStyle={{ borderRadius: 10 }} />
                <Bar dataKey="count" name="Events" fill="#00C2A8" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No source data in this period.</div>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-12">
        <Card className="min-w-0 xl:col-span-8">
          <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-sm">Top Activity · 24h</CardTitle><p className="mt-1 text-xs text-muted-foreground">Latest 16 events in your workspace</p></div><Button asChild variant="outline" size="sm"><Link href="/live-logs">Live logs <ArrowUpRight className="ml-2 size-3.5" /></Link></Button></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-y bg-muted/30 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Time</th><th className="px-4 py-3 font-medium">Source</th><th className="px-4 py-3 font-medium">Activity</th><th className="px-4 py-3 font-medium">Type</th></tr></thead>
                <tbody className="divide-y">
                  {logsQuery.isLoading ? <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">Loading activity…</td></tr> : logMetrics.topActivity.length ? logMetrics.topActivity.map((row, index) => <tr key={`${row.time}-${index}`} className="hover:bg-muted/20"><td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{row.time}</td><td className="px-4 py-3">{row.source}</td><td className="max-w-lg truncate px-4 py-3">{row.action}</td><td className="px-4 py-3"><Badge variant={row.type === "error" ? "destructive" : "outline"}>{row.type}</Badge></td></tr>) : <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">No activity in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-sm">Recent Alerts</CardTitle><p className="mt-1 text-xs text-muted-foreground">Most recently created or triggered rules</p></div><Button asChild variant="ghost" size="icon-sm" aria-label="View alerts"><Link href="/alerts"><ArrowUpRight className="size-4" /></Link></Button></CardHeader>
          <CardContent className="space-y-3">
            {alertsQuery.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading alerts…</p> : recentAlerts.length ? recentAlerts.map((alert) => <article key={alert.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{alert.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{alert.app_name} · {alert.summary}</p></div><Badge variant={alert.status === "active" ? "secondary" : "outline"}>{alert.status}</Badge></div>
              <p className="mt-3 text-xs text-muted-foreground">{relativeTime(alert.last_triggered ?? alert.created_at)}</p>
            </article>) : <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><Bell className="size-5 opacity-50" />No alert rules configured.</div>}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
