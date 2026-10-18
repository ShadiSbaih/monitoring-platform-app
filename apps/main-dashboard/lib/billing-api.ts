export type PlanName = "free" | "starter" | "pro" | "business";

export interface CurrentPlanResponse {
  plan: PlanName;
}

export interface InvoiceRecord {
  id: string;
  stripe_invoice_id: string;
  status: string;
  currency: string;
  amount_due: number;
  amount_paid: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/billing/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `Billing request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetchCurrentPlan(): Promise<CurrentPlanResponse> {
  return request<CurrentPlanResponse>("current");
}

export async function fetchInvoices(): Promise<InvoiceRecord[]> {
  const result = await request<InvoiceRecord[] | { invoices?: InvoiceRecord[] }>("invoices");
  return Array.isArray(result) ? result : result.invoices ?? [];
}

export function createCheckoutSession(selectedPlan: Exclude<PlanName, "free">): Promise<{ url: string }> {
  return request<{ url: string }>("checkout", {
    method: "POST",
    body: JSON.stringify({ selectedPlan }),
  });
}

export function createPortalSession(): Promise<{ url: string }> {
  return request<{ url: string }>("portal", { method: "POST", body: JSON.stringify({}) });
}
