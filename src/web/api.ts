export interface EventRow {
  id: number;
  ts: number;
  ingested_at: number;
  source: string;
  host: string;
  category: "auth" | "network" | "process" | "web" | "system" | "other";
  action: string;
  outcome: "success" | "failure" | "unknown";
  severity: number;
  src_ip: string | null;
  dst_ip: string | null;
  user: string | null;
  message: string;
  fields: Record<string, unknown>;
  raw: string;
}
export type Status = "open" | "acknowledged" | "closed";
export interface AlertRow {
  id: number;
  rule_id: string;
  rule_name: string;
  severity: number;
  mitre: string;
  group_key: string;
  title: string;
  first_seen: number;
  last_seen: number;
  count: number;
  status: Status;
  created_at: number;
  updated_at: number;
}
export interface Rule {
  id: string;
  name: string;
  description: string;
  kind: "match" | "threshold" | "sequence";
  severity: number;
  mitre: string;
  enabled: boolean;
  alerts_open: number;
  alerts_total: number;
}
export interface Bucket {
  t: number;
  total: number;
  failure: number;
}
export interface Stats {
  total: number;
  bucket_ms: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_outcome: Record<string, number>;
  timeline: Bucket[];
  top_src_ips: Top[];
  top_users: Top[];
  top_sources: Top[];
  alerts_open: number;
  alerts_by_severity: Record<string, number>;
}
export interface Top {
  value: string;
  count: number;
}
export interface EventPage {
  events: EventRow[];
  next_cursor: string | null;
}
export interface AlertPage {
  alerts: AlertRow[];
  next_cursor: string | null;
}
export type EventDetail = EventRow & { alerts: AlertRow[] };
export type AlertDetail = AlertRow & { events: EventRow[] };
export function query(
  values: Record<string, string | number | null | undefined>,
) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== null && v !== undefined && String(v).trim() !== "")
      p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
export async function api<T>(
  path: string,
  signal?: AbortSignal,
  body?: object,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    signal,
    ...(body
      ? {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`,
    );
  return data as T;
}

export interface AlertSummary {
  open: number;
  acknowledged: number;
  closed: number;
  open_by_severity: Record<string, number>;
}
