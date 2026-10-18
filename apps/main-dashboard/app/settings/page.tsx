"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createCheckoutSession,
  createPortalSession,
  fetchCurrentPlan,
  fetchInvoices,
  type InvoiceRecord,
  type PlanName,
} from "@/lib/billing-api";

type PlanFeature = { label: string; included: boolean };
type PlanDetails = {
  name: string;
  price: string;
  summary: string;
  eventLimit: string;
  retention: string;
  alertLimit: string;
  popular?: boolean;
  features: PlanFeature[];
};

const PLAN_DETAILS: Record<PlanName, PlanDetails> = {
  free: {
    name: "Free", price: "$0", summary: "Start seeing your application clearly.",
    eventLimit: "10,000 events / month", retention: "7 day retention", alertLimit: "No active alerts",
    features: [
      { label: "10,000 events each month", included: true },
      { label: "7 day log retention", included: true },
      { label: "Search and live streaming", included: true },
      { label: "API access", included: true },
      { label: "Alert rules and webhooks", included: false },
    ],
  },
  starter: {
    name: "Starter", price: "$9.99", summary: "Reliable visibility for growing products.",
    eventLimit: "100,000 events / month", retention: "30 day retention", alertLimit: "5 active alerts", popular: true,
    features: [
      { label: "100,000 events each month", included: true },
      { label: "30 day log retention", included: true },
      { label: "Search and live streaming", included: true },
      { label: "API access", included: true },
      { label: "5 alert rules and signed webhooks", included: true },
    ],
  },
  pro: {
    name: "Pro", price: "$24.99", summary: "More room for teams and production systems.",
    eventLimit: "500,000 events / month", retention: "60 day retention", alertLimit: "12 active alerts",
    features: [
      { label: "500,000 events each month", included: true },
      { label: "60 day log retention", included: true },
      { label: "Search and live streaming", included: true },
      { label: "API access", included: true },
      { label: "12 alert rules and signed webhooks", included: true },
    ],
  },
  business: {
    name: "Business", price: "$49.99", summary: "Higher limits for critical workloads.",
    eventLimit: "1,000,000 events / month", retention: "90 day retention", alertLimit: "20 active alerts",
    features: [
      { label: "1,000,000 events each month", included: true },
      { label: "90 day log retention", included: true },
      { label: "Search and live streaming", included: true },
      { label: "API access", included: true },
      { label: "20 alert rules and signed webhooks", included: true },
    ],
  },
};

const paidPlans = ["starter", "pro", "business"] as const;

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function invoiceDownloadUrl(invoice: InvoiceRecord): string | null {
  return invoice.invoice_pdf || invoice.hosted_invoice_url || null;
}

export default function SettingsPage() {
  const planQuery = useQuery({ queryKey: ["current-plan"], queryFn: fetchCurrentPlan });
  const invoiceQuery = useQuery({ queryKey: ["billing-invoices"], queryFn: fetchInvoices });
  const currentPlan = planQuery.data?.plan ?? "free";

  const checkoutMutation = useMutation({
    mutationFn: createCheckoutSession,
    onSuccess: ({ url }) => { window.location.assign(url); },
    onError: (error: Error) => toast.error(error.message),
  });
  const portalMutation = useMutation({
    mutationFn: createPortalSession,
    onSuccess: ({ url }) => { window.location.assign(url); },
    onError: (error: Error) => toast.error(error.message),
  });

  const invoices = invoiceQuery.data ?? [];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Workspace / Billing</p>
          <h1 className="text-3xl font-semibold tracking-tight">Plans and billing</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose the event volume and retention your applications need.</p>
        </div>
        {currentPlan !== "free" && <Button variant="outline" disabled={portalMutation.isPending} onClick={() => portalMutation.mutate()}>
          {portalMutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ArrowUpRight className="mr-2 size-4" />}
          Manage Billing
        </Button>}
      </header>

      {planQuery.error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{planQuery.error.message}</p>}
      {checkoutMutation.error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{checkoutMutation.error.message}</p>}

      <section aria-label="Available plans" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(PLAN_DETAILS) as PlanName[]).map((plan) => {
          const details = PLAN_DETAILS[plan];
          const isCurrent = plan === currentPlan;
          const showPopular = Boolean(details.popular && planQuery.data?.plan === "free");
          return <Card key={plan} className={`relative flex min-h-full flex-col ${isCurrent ? "border-primary/50 shadow-lg shadow-primary/5" : ""}`}>
            {showPopular && <Badge className="absolute right-4 top-4 gap-1"><Sparkles className="size-3" /> POPULAR</Badge>}
            <CardHeader>
              <div className="flex items-center gap-2"><CardTitle>{details.name}</CardTitle>{isCurrent && <Badge variant="secondary">Current plan</Badge>}</div>
              <CardDescription className="min-h-10">{details.summary}</CardDescription>
              <p className="pt-2 text-3xl font-semibold">{details.price}<span className="ml-1 text-sm font-normal text-muted-foreground">/ month</span></p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-5">
              <div className="space-y-1 text-xs text-muted-foreground"><p>{details.eventLimit}</p><p>{details.retention}</p><p>{details.alertLimit}</p></div>
              <ul className="flex-1 space-y-3 border-t pt-4 text-sm">
                {details.features.map((feature) => <li key={feature.label} className={`flex items-start gap-2 ${feature.included ? "" : "text-muted-foreground"}`}>
                  <Check className={`mt-0.5 size-4 shrink-0 ${feature.included ? "text-emerald-400" : "opacity-30"}`} />
                  <span>{feature.label}</span>
                </li>)}
              </ul>
              {plan === "free" ? <Button variant="outline" disabled>{isCurrent ? "Current plan" : "Included"}</Button> : <Button
                variant={isCurrent ? "outline" : "default"}
                disabled={isCurrent || planQuery.isLoading || checkoutMutation.isPending || currentPlan !== "free"}
                onClick={() => checkoutMutation.mutate(plan)}
              >
                {checkoutMutation.isPending && checkoutMutation.variables === plan ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {isCurrent ? "Current plan" : currentPlan !== "free" ? "Manage in billing portal" : "Choose plan"}
              </Button>}
            </CardContent>
          </Card>;
        })}
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div><CardTitle>Invoices</CardTitle><CardDescription>Receipts and billing history for your workspace.</CardDescription></div>
          <Badge variant="outline">{invoices.length} invoices</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {invoiceQuery.error && <p role="alert" className="m-4 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{invoiceQuery.error.message}</p>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Invoice ID</TableHead><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>
                {invoiceQuery.isLoading ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">Loading invoices…</TableCell></TableRow> : invoices.length ? invoices.map((invoice) => {
                  const downloadUrl = invoiceDownloadUrl(invoice);
                  return <TableRow key={invoice.stripe_invoice_id}>
                    <TableCell className="font-mono text-xs">{invoice.stripe_invoice_id.slice(0, 8)}...</TableCell>
                    <TableCell>{formatDate(invoice.created_at)}</TableCell>
                    <TableCell>{formatAmount(invoice.amount_paid || invoice.amount_due, invoice.currency)}</TableCell>
                    <TableCell><Badge variant={invoice.status === "paid" ? "secondary" : "outline"}>{invoice.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" disabled={!downloadUrl} onClick={() => downloadUrl && window.open(downloadUrl, "_blank", "noopener,noreferrer")}>
                      <Download className="mr-2 size-4" /> Download PDF
                    </Button></TableCell>
                  </TableRow>;
                }) : <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No invoices available yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
