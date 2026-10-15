import {
  base,
  categories,
  outcomes,
  type NormalizedEventInput,
} from "../schema";
export function normalize(
  value: unknown,
  now = Date.now(),
): NormalizedEventInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("event must be an object");
  const v = value as Record<string, unknown>;
  const e = base("", { now });
  for (const key of ["source", "host", "action", "message", "raw"] as const) {
    if (v[key] !== undefined) {
      if (typeof v[key] !== "string")
        throw new Error(`${key} must be a string`);
      e[key] = v[key];
    }
  }
  for (const key of ["src_ip", "dst_ip", "user"] as const) {
    if (v[key] != null) {
      if (typeof v[key] !== "string")
        throw new Error(`${key} must be a string or null`);
      e[key] = v[key];
    }
  }
  if (v.ts !== undefined) {
    if (typeof v.ts !== "number" && typeof v.ts !== "string")
      throw new Error("invalid ts");
    const ts =
      typeof v.ts === "string" && !/^\d+$/.test(v.ts)
        ? Date.parse(v.ts)
        : Number(v.ts);
    if (!Number.isSafeInteger(ts) || ts < 0) throw new Error("invalid ts");
    e.ts = ts;
  }
  if (v.severity !== undefined) {
    if (
      typeof v.severity !== "number" &&
      (typeof v.severity !== "string" || !/^[0-4]$/.test(v.severity))
    )
      throw new Error("invalid severity");
    const n = Number(v.severity);
    if (!Number.isInteger(n) || n < 0 || n > 4)
      throw new Error("invalid severity");
    e.severity = n;
  }
  if (v.category !== undefined) {
    if (!categories.includes(v.category as never))
      throw new Error("invalid category");
    e.category = v.category as NormalizedEventInput["category"];
  }
  if (v.outcome !== undefined) {
    if (!outcomes.includes(v.outcome as never))
      throw new Error("invalid outcome");
    e.outcome = v.outcome as NormalizedEventInput["outcome"];
  }
  if (v.fields !== undefined) {
    if (!v.fields || typeof v.fields !== "object" || Array.isArray(v.fields))
      throw new Error("fields must be an object");
    e.fields = v.fields as Record<string, unknown>;
  }
  e.raw = typeof v.raw === "string" ? v.raw : JSON.stringify(v);
  return e;
}
