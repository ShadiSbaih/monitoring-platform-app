export type AlertCondition = {
  field: "type" | "message" | "importance" | "environment" | "service" | "subsystem" | "operation";
  operator: "equals" | "not_equals";
  value: string;
};

export interface AlertRule {
  id: string;
  name: string;
  app_name: string;
  conditions: AlertCondition[];
  threshold_count: number;
  threshold_window_minutes: number;
  webhook_url: string;
  cooldown_period: string;
  summary: string;
  status: "active" | "muted" | string;
  last_triggered: string | null;
  created_at: string;
}

export interface CreateAlertPayload {
  name: string;
  app_name: string;
  conditions: AlertCondition[];
  threshold: { count: number; window_minutes: number };
  webhook_url: string;
  cooldown_period: string;
  summary: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `Alert request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function fetchAlerts(): Promise<AlertRule[]> {
  return request<AlertRule[]>("alerts");
}

export function createAlert(payload: CreateAlertPayload): Promise<AlertRule> {
  return request<AlertRule>("alerts", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteAlert(alertId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`alerts/${encodeURIComponent(alertId)}`, { method: "DELETE" });
}
