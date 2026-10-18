"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/auth-provider";
import { Check, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { format } from "timeago.js";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ApiKey = {
  id: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ApiKeyLastUsed = { last_used_at: string | null };

const SERVER_URI = "/api/v1";

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {

  const response = await fetch(`${SERVER_URI}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(message || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function relativeTime(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? emptyLabel : format(date);
}

export default function ApiKeysPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ApiKey | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["api-keys"],
    enabled: isLoaded && Boolean(isSignedIn),
    queryFn: () => apiRequest<ApiKey[]>("/api-keys"),
  });

  const lastUsedQuery = useQuery({
    queryKey: ["api-keys", selected?.id, "last-used"],
    enabled: isLoaded && Boolean(isSignedIn) && Boolean(selected?.id),
    queryFn: () => apiRequest<ApiKeyLastUsed>(`/api-keys/${selected!.id}`),
  });

  const createKey = useMutation({
    mutationFn: () => apiRequest<{ key: string }>("/api-keys", { method: "POST" }),
    onSuccess: async ({ key }) => {
      setError(null);
      setGeneratedKey(key);
      setRevealOpen(true);
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const revokeKey = useMutation({
    mutationFn: (keyId: string) =>
      apiRequest<{ revoked: true }>(`/api-keys/${keyId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setError(null);
      setSelected(null);
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const keys = keysQuery.data ?? [];
  const activeCount = keys.filter((key) => key.revoked_at === null).length;
  const selectedLastUsed = lastUsedQuery.data?.last_used_at ?? selected?.last_used_at;

  async function copyGeneratedKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard access failed. Select and copy the key manually.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and revoke credentials for sending logs to Tracebloom.
          </p>
        </div>
        <Button
          onClick={() => createKey.mutate()}
          disabled={!isLoaded || !isSignedIn || createKey.isPending || keys.length >= 5}
        >
          {createKey.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Generate New Key
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="API key summary">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total keys</p>
          <p className="mt-2 text-2xl font-semibold">{keys.length} <span className="text-sm font-normal text-muted-foreground">/ 5</span></p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Active</p>
          <p className="mt-2 text-2xl font-semibold">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Security</p>
          <p className="mt-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-emerald-500" /> Secrets shown once</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="font-medium">Your API keys</h2>
          <p className="mt-1 text-xs text-muted-foreground">Only the key prefix is stored for display.</p>
        </div>
        {keysQuery.isPending ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading API keys
          </div>
        ) : keysQuery.isError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">{keysQuery.error.message}</p>
            <Button variant="outline" onClick={() => void keysQuery.refetch()}>Try again</Button>
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <KeyRound className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No API keys yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Generate a key to connect your application.</p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const revoked = key.revoked_at !== null;
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-mono text-sm">{key.prefix}</TableCell>
                    <TableCell>{relativeTime(key.created_at, "Unknown")}</TableCell>
                    <TableCell>{relativeTime(key.last_used_at, "No uses yet")}</TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2.5 py-1 text-xs ${revoked ? "bg-muted text-muted-foreground" : "bg-emerald-500/10 text-emerald-600"}`}>
                        {revoked ? "Revoked" : "Active"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setError(null); setSelected(key); }}>
                        View details
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {keys.length >= 5 && <p className="border-t px-5 py-3 text-xs text-muted-foreground">You have reached the 5 key limit.</p>}
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>API key details</SheetTitle>
            <SheetDescription>Review activity or revoke this credential.</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-5 px-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Key prefix</p>
                <code className="block break-all rounded-md bg-muted p-3 text-xs">{selected.prefix}</code>
              </div>
              <dl className="space-y-4 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Created</dt><dd>{relativeTime(selected.created_at, "Unknown")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Last used</dt><dd>{lastUsedQuery.isPending ? "Loadingâ€¦" : relativeTime(selectedLastUsed, "No uses yet")}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Status</dt><dd>{selected.revoked_at ? "Revoked" : "Active"}</dd></div>
              </dl>
              {selected.revoked_at === null && (
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={revokeKey.isPending}
                  onClick={() => revokeKey.mutate(selected.id)}
                >
                  {revokeKey.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  Revoke key
                </Button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={revealOpen} onOpenChange={(open) => {
        setRevealOpen(open);
        if (!open) { setGeneratedKey(null); setCopied(false); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy this key now. For security, the full secret will not be shown again.
            </DialogDescription>
          </DialogHeader>
          {generatedKey && <code className="block max-h-32 overflow-auto break-all rounded-md border bg-muted p-3 text-xs">{generatedKey}</code>}
          <DialogFooter>
            <Button onClick={() => void copyGeneratedKey()} disabled={!generatedKey}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
