"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "timeago.js";
import { Bell, CircleAlert, Clock3, ListFilter, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { createAlert, deleteAlert, fetchAlerts, type AlertCondition, type AlertRule } from "@/lib/alerts-api";

const conditionFields: Array<{ value: AlertCondition["field"]; label: string }> = [
  { value: "type", label: "Log type" },
  { value: "message", label: "Message" },
  { value: "importance", label: "Importance" },
  { value: "environment", label: "Environment" },
  { value: "service", label: "Service" },
  { value: "subsystem", label: "Subsystem" },
  { value: "operation", label: "Operation" },
];

const emptyCondition: AlertCondition = { field: "type", operator: "equals", value: "error" };
const cooldownOptions = ["5m", "10m", "30m", "1h", "6h", "24h"];

function newForm() {
  return {
    name: "",
    app_name: "",
    conditions: [{ ...emptyCondition }] as AlertCondition[],
    thresholdCount: 5,
    thresholdWindow: 5,
    webhook_url: "",
    cooldown_period: "5m",
  };
}

function conditionText(condition: AlertCondition): string {
  const field = conditionFields.find((item) => item.value === condition.field)?.label ?? condition.field;
  const operator = condition.operator === "equals" ? "is" : "is not";
  return `${field} ${operator} ${condition.value || "â€¦"}`;
}

function summaryFor(form: ReturnType<typeof newForm>): string {
  const conditions = form.conditions.map(conditionText).join(" and ") || "matching conditions";
  return `Alert when ${form.thresholdCount || 1} matching ${form.app_name || "application"} logs occur within ${form.thresholdWindow || 1} minutes where ${conditions}.`;
}

function relativeTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : format(date);
}

function ruleCondition(rule: AlertRule): string {
  const conditionTextValue = rule.conditions.map(conditionText).join(" and ");
  return `${rule.threshold_count} matching logs in ${rule.threshold_window_minutes}m${conditionTextValue ? ` Â· ${conditionTextValue}` : ""}`;
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const alertQuery = useQuery({ queryKey: ["alerts"], queryFn: fetchAlerts });

  const [newAlertOpen, setNewAlertOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(newForm);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const alerts = alertQuery.data ?? [];
  const activeAlerts = alerts.filter((alert) => alert.status === "active");
  const mutedAlerts = alerts.filter((alert) => alert.status === "muted");
  const latestTriggered = alerts
    .filter((alert) => alert.last_triggered)
    .sort((left, right) => new Date(right.last_triggered!).getTime() - new Date(left.last_triggered!).getTime())[0];
  const visibleAlerts = useMemo(() => alerts.filter((alert) => {
    const searchMatch = `${alert.name} ${alert.app_name} ${alert.summary}`.toLowerCase().includes(search.trim().toLowerCase());
    return searchMatch && (statusFilter === "all" || alert.status === statusFilter);
  }), [alerts, search, statusFilter]);

  const createMutation = useMutation({
    mutationFn: createAlert,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Alert rule created");
      setNewAlertOpen(false);
      setForm(newForm());
      setStep(1);
      setFormError("");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAlert,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Alert rule deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function openBuilder() {
    if (activeAlerts.length >= 3) { toast.error("You can have up to 3 active alerts"); return; }
    setFormError("");
    setNewAlertOpen(true);
  }

  function updateCondition(index: number, next: Partial<AlertCondition>) {
    setForm((current) => ({
      ...current,
      conditions: current.conditions.map((condition, itemIndex) => {
        if (itemIndex !== index) return condition;
        const updated = { ...condition, ...next };
        if (next.field === "importance") updated.value = "critical";
        return updated;
      }),
    }));
  }

  function nextStep() {
    if (step === 1 && !form.name.trim()) return setFormError("Enter a name for this alert.");
    if (step === 2) {
      if (!form.app_name.trim()) return setFormError("Enter the application name to monitor.");
      if (!form.conditions.length || form.conditions.some((condition) => !condition.value.trim())) return setFormError("Complete every condition before continuing.");
      if (!Number.isInteger(form.thresholdCount) || form.thresholdCount < 1 || !Number.isInteger(form.thresholdWindow) || form.thresholdWindow < 1) return setFormError("Threshold values must be whole numbers greater than zero.");
    }
    if (step === 3) {
      try {
        const url = new URL(form.webhook_url);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        return setFormError("Enter a valid HTTP or HTTPS webhook URL.");
      }
    }
    setFormError("");
    setStep((current) => Math.min(4, current + 1));
  }

  function submitAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate({
      name: form.name.trim(),
      app_name: form.app_name.trim(),
      conditions: form.conditions,
      threshold: { count: form.thresholdCount, window_minutes: form.thresholdWindow },
      webhook_url: form.webhook_url.trim(),
      cooldown_period: form.cooldown_period,
      summary: summaryFor(form),
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Observability / Alerts</p>
          <h1 className="text-3xl font-semibold tracking-tight">Alert rules</h1>
          <p className="mt-2 text-sm text-muted-foreground">Get a signed webhook when important log patterns cross your threshold.</p>
        </div>
        <Button onClick={openBuilder}><Plus className="mr-2 size-4" /> New Alert</Button>
      </header>

      <section aria-label="Alert statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Active</CardTitle><Bell className="size-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-2xl font-semibold">{activeAlerts.length}</p><p className="text-xs text-muted-foreground">Rules currently monitoring logs</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Muted</CardTitle><CircleAlert className="size-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-2xl font-semibold">{mutedAlerts.length}</p><p className="text-xs text-muted-foreground">Rules temporarily paused</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Last Triggered</CardTitle><Clock3 className="size-4 text-muted-foreground" /></CardHeader><CardContent><p className="truncate text-2xl font-semibold">{relativeTime(latestTriggered?.last_triggered ?? null)}</p><p className="text-xs text-muted-foreground">Most recent alert delivery</p></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Alerts</CardTitle><ListFilter className="size-4 text-muted-foreground" /></CardHeader><CardContent><p className="text-2xl font-semibold">{alerts.length}</p><p className="text-xs text-muted-foreground">Configured rules</p></CardContent></Card>
      </section>

      <Card>
        <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3">
          <div><CardTitle>Rules</CardTitle><p className="mt-1 text-sm text-muted-foreground">Filter by name, app, summary, or status.</p></div>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Filter alerts" placeholder="Filter alert rules" value={search} onChange={(event) => setSearch(event.target.value)} className="w-56" />
            <select aria-label="Filter alert status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
              <option value="all">All statuses</option><option value="active">Active</option><option value="muted">Muted</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {alertQuery.error && <p role="alert" className="m-4 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{alertQuery.error.message}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-y bg-muted/30 text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Application</th><th className="px-4 py-3 font-medium">Threshold</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Last Triggered</th><th className="px-4 py-3 text-right font-medium">Action</th></tr></thead>
              <tbody className="divide-y">
                {alertQuery.isLoading ? <tr><td colSpan={6} className="px-4 py-14 text-center text-muted-foreground">Loading alert rulesâ€¦</td></tr> : visibleAlerts.length ? visibleAlerts.map((alert) => (
                  <tr key={alert.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3"><p className="font-medium">{alert.name}</p><p className="mt-1 max-w-xs truncate text-xs text-muted-foreground">{alert.summary}</p></td>
                    <td className="px-4 py-3">{alert.app_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ruleCondition(alert)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs capitalize ${alert.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground"}`}>{alert.status}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{relativeTime(alert.last_triggered)}</td>
                    <td className="px-4 py-3 text-right"><Button variant="ghost" size="icon-sm" aria-label={`Delete ${alert.name}`} disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(alert.id)}><Trash2 className="size-4 text-muted-foreground" /></Button></td>
                  </tr>
                )) : <tr><td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">{alerts.length ? "No rules match this filter." : "No alert rules yet. Create a rule to start monitoring events."}</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={newAlertOpen} onOpenChange={(open) => { setNewAlertOpen(open); if (!open) { setStep(1); setFormError(""); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create an alert rule</DialogTitle>
            <DialogDescription>Step {step} of 4 Â· {(["Name", "Rule", "Webhook", "Cooldown"] as const)[step - 1]}</DialogDescription>
          </DialogHeader>
          <div className="mb-2 flex gap-2" aria-label="Alert builder progress">
            {[1, 2, 3, 4].map((number) => <span key={number} className={`h-1.5 flex-1 rounded-full ${number <= step ? "bg-primary" : "bg-muted"}`} />)}
          </div>
          <form onSubmit={submitAlert} className="space-y-5">
            {step === 1 && <div className="space-y-2"><label htmlFor="alert-name" className="text-sm font-medium">Alert name</label><Input id="alert-name" autoFocus placeholder="Critical API errors" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>}

            {step === 2 && <div className="space-y-5">
              <div className="space-y-2"><label htmlFor="alert-app" className="text-sm font-medium">Application name</label><Input id="alert-app" placeholder="tracebloom" value={form.app_name} onChange={(event) => setForm((current) => ({ ...current, app_name: event.target.value }))} /></div>
              <div className="space-y-3">
                <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Conditions</h3><Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, conditions: [...current.conditions, { ...emptyCondition }] }))}><Plus className="mr-1 size-3.5" /> Add condition</Button></div>
                {form.conditions.map((condition, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1.2fr_32px]">
                  <select aria-label={`Condition ${index + 1} field`} value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value as AlertCondition["field"] })} className="h-9 rounded-md border bg-background px-2 text-sm">
                    {conditionFields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                  </select>
                  <select aria-label={`Condition ${index + 1} operator`} value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value as AlertCondition["operator"] })} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="equals">equals</option><option value="not_equals">does not equal</option></select>
                  {condition.field === "importance" ? <select aria-label={`Condition ${index + 1} importance`} value={condition.value} onChange={(event) => updateCondition(index, { value: event.target.value })} className="h-9 rounded-md border bg-background px-2 text-sm"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select> : <Input aria-label={`Condition ${index + 1} value`} placeholder="Value" value={condition.value} onChange={(event) => updateCondition(index, { value: event.target.value })} />}
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove condition" disabled={form.conditions.length === 1} onClick={() => setForm((current) => ({ ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) }))}><X className="size-4" /></Button>
                </div>)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="threshold-count" className="text-sm font-medium">Matching logs</label><Input id="threshold-count" type="number" min={1} step={1} value={form.thresholdCount} onChange={(event) => setForm((current) => ({ ...current, thresholdCount: Number(event.target.value) }))} /></div><div className="space-y-2"><label htmlFor="threshold-window" className="text-sm font-medium">Within minutes</label><Input id="threshold-window" type="number" min={1} step={1} value={form.thresholdWindow} onChange={(event) => setForm((current) => ({ ...current, thresholdWindow: Number(event.target.value) }))} /></div></div>
              <div className="rounded-lg border bg-muted/30 p-3"><p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Rule summary</p><p className="text-sm">{summaryFor(form)}</p></div>
            </div>}

            {step === 3 && <div className="space-y-2"><label htmlFor="webhook-url" className="text-sm font-medium">Webhook URL</label><Input id="webhook-url" type="url" placeholder="https://example.com/hooks/tracebloom" value={form.webhook_url} onChange={(event) => setForm((current) => ({ ...current, webhook_url: event.target.value }))} /><p className="text-xs text-muted-foreground">Requests include an HMAC-SHA256 signature and a 60-second timestamp.</p></div>}

            {step === 4 && <div className="space-y-5"><div className="space-y-2"><label htmlFor="cooldown" className="text-sm font-medium">Cooldown period</label><select id="cooldown" value={form.cooldown_period} onChange={(event) => setForm((current) => ({ ...current, cooldown_period: event.target.value }))} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{cooldownOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select><p className="text-xs text-muted-foreground">Weâ€™ll wait this long after a trigger before sending the next notification.</p></div><div className="rounded-lg border p-4"><p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Final rule</p><p className="text-sm">{summaryFor(form)}</p><p className="mt-3 text-xs text-muted-foreground">Send to {form.webhook_url || "your webhook URL"} Â· cooldown {form.cooldown_period}</p></div></div>}

            {formError && <p role="alert" className="rounded-md border border-destructive/30 p-2 text-sm text-destructive">{formError}</p>}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => step > 1 ? setStep((current) => current - 1) : setNewAlertOpen(false)}>{step === 1 ? "Cancel" : "Back"}</Button>
              {step < 4 ? <Button type="button" onClick={nextStep}>Continue</Button> : <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Create Alert</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
