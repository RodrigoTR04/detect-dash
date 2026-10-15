export const categories = [
  "auth",
  "network",
  "process",
  "web",
  "system",
  "other",
] as const;
export const outcomes = ["success", "failure", "unknown"] as const;
export interface NormalizedEventInput {
  ts: number;
  source: string;
  host: string;
  category: (typeof categories)[number];
  action: string;
  outcome: (typeof outcomes)[number];
  severity: number;
  src_ip: string | null;
  dst_ip: string | null;
  user: string | null;
  message: string;
  fields: Record<string, unknown>;
  raw: string;
}
export interface Event extends NormalizedEventInput {
  id: number;
  ingested_at: number;
}
export interface ParseContext {
  now?: number;
  ts?: number;
  source?: string;
  host?: string;
  fields?: Record<string, unknown>;
  severity?: number;
}
export type Parser = (
  line: string,
  ctx: ParseContext,
) => NormalizedEventInput | null;
export function base(line: string, ctx: ParseContext): NormalizedEventInput {
  return {
    ts: ctx.ts ?? ctx.now ?? Date.now(),
    source: ctx.source ?? "app",
    host: ctx.host ?? "unknown",
    category: "other",
    action: "log",
    outcome: "unknown",
    severity: ctx.severity ?? 0,
    src_ip: null,
    dst_ip: null,
    user: null,
    message: line,
    fields: { ...ctx.fields },
    raw: line,
  };
}
