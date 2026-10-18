"use client";
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/auth-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
export default function SettingsPage() {
  const { user } = useAuth();
  const usage = useQuery({ queryKey: ['usage'], queryFn: async () => {
    const response = await fetch('/api/v1/logs/usage', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load usage');
    return response.json() as Promise<{ day: string; events_used: number; events_limit: number; remaining: number }>;
  }, refetchInterval: 60_000 });
  return <main className="space-y-6 p-6"><header><h1 className="text-3xl font-semibold">Account and usage</h1><p className="mt-2 text-muted-foreground">One free offering for every personal account.</p></header>
    <Card><CardHeader><CardTitle>Personal account</CardTitle></CardHeader><CardContent><p>{user?.name}</p><p className="text-sm text-muted-foreground">{user?.email}</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Daily allowance</CardTitle></CardHeader><CardContent className="space-y-3">
      {usage.isError ? <p role="alert">{usage.error.message}</p> : usage.data ? <><p className="text-2xl font-semibold">{usage.data.events_used.toLocaleString()} / {usage.data.events_limit.toLocaleString()} logs</p><p>{usage.data.remaining.toLocaleString()} remaining today. Resets at 00:00 UTC.</p></> : <p role="status">Loading usage...</p>}
      <p className="text-sm text-muted-foreground">7-day retention | 3 active alerts | 3 active API keys | 100 logs per batch.</p>
      <p className="text-sm text-muted-foreground">Shared platform limits may temporarily pause ingestion. The service can take time to wake after inactivity.</p>
    </CardContent></Card></main>;
}
