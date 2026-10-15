import type { DB } from "../db";
import type { Event } from "../schema";
import { rules as builtins, type Condition, type Rule } from "./rules";
export function field(event: Event, path: string): unknown {
  if (path.startsWith("fields.")) return event.fields[path.slice(7)];
  return (event as unknown as Record<string, unknown>)[path];
}
const regexes = new WeakMap<Condition, RegExp>();
export function matches(event: Event, c: Condition): boolean {
  if ("all" in c) return c.all.every((x) => matches(event, x));
  if ("any" in c) return c.any.some((x) => matches(event, x));
  if ("not" in c) return !matches(event, c.not);
  let value = field(event, c.field);
  if (c.decode && typeof value === "string") {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* Keep malformed URLs searchable. */
    }
  }
  switch (c.op) {
    case "equals":
      return value === c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(value);
    case "regex": {
      let regex = regexes.get(c);
      if (!regex) {
        regex = new RegExp(String(c.value), c.flags);
        regexes.set(c, regex);
      }
      regex.lastIndex = 0;
      return typeof value === "string" && regex.test(value);
    }
    case "gte":
      return (
        typeof value === "number" &&
        typeof c.value === "number" &&
        value >= c.value
      );
    case "lte":
      return (
        typeof value === "number" &&
        typeof c.value === "number" &&
        value <= c.value
      );
  }
}
interface Entry {
  ts: number;
  id: number;
  value: unknown;
}
interface Window {
  watermark: number;
  entries: Entry[];
  values: Map<unknown, number>;
}
function expireFront(w: Window, count: number) {
  for (let i = 0; i < count; i++) {
    const value = w.entries[i]!.value;
    const remaining = w.values.get(value)! - 1;
    if (remaining) w.values.set(value, remaining);
    else w.values.delete(value);
  }
  if (count) w.entries.splice(0, count);
}
function bound(entries: Entry[], ts: number, inclusive: boolean) {
  let lo = 0,
    hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid]!.ts < ts || (inclusive && entries[mid]!.ts === ts))
      lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export class DetectionEngine {
  private state = new Map<string, Map<string, Window>>();
  private flags = new Map<string, boolean>();
  private sweeps = new Map<string, number>();
  constructor(
    private db: DB,
    readonly rules: Rule[] = builtins,
    private publish: (alert: unknown) => void = () => {},
  ) {
    const insert = db.query("INSERT OR IGNORE INTO rule_state VALUES (?,1)");
    for (const rule of rules) insert.run(rule.id);
    for (const row of db
      .query("SELECT rule_id,enabled FROM rule_state")
      .all() as { rule_id: string; enabled: number }[])
      this.flags.set(row.rule_id, row.enabled === 1);
  }
  enabled(id: string) {
    return this.flags.get(id) === true;
  }
  setEnabled(id: string, enabled: boolean) {
    this.db
      .query("UPDATE rule_state SET enabled=? WHERE rule_id=?")
      .run(Number(enabled), id);
    this.flags.set(id, enabled);
    this.state.delete(id);
    this.sweeps.delete(id);
  }
  evaluate(events: Event[]) {
    const enabledRules = this.rules.filter((rule) => this.enabled(rule.id));
    for (const e of [...events].sort((a, b) => a.ts - b.ts || a.id - b.id))
      for (const rule of enabledRules) {
        const values = rule.groupBy.map((k) => field(e, k));
        if (values.some((v) => v == null || v === "")) continue;
        const key = JSON.stringify(values);
        if (rule.kind === "match") {
          if (matches(e, rule.condition))
            this.alert(rule, key, e, [e.id], values);
          continue;
        }
        const isA = matches(
          e,
          rule.kind === "sequence" ? rule.a : rule.condition,
        );
        const isB = rule.kind === "sequence" && matches(e, rule.b);
        if (!isA && !isB) continue;
        let groups = this.state.get(rule.id);
        if (!groups) this.state.set(rule.id, (groups = new Map()));
        const swept = this.sweeps.get(rule.id);
        if (swept === undefined || e.ts - swept >= rule.windowMs) {
          for (const [k, w] of groups)
            if (w.watermark < e.ts - rule.windowMs) groups.delete(k);
          this.sweeps.set(rule.id, e.ts);
        }
        const w: Window = groups.get(key) ?? {
          watermark: e.ts,
          entries: [],
          values: new Map(),
        };
        w.watermark = Math.max(w.watermark, e.ts);
        const expired = bound(w.entries, w.watermark - rule.windowMs, false);
        expireFront(w, expired);
        if (e.ts < w.watermark - rule.windowMs) continue;
        groups.delete(key);
        groups.set(key, w);
        if (groups.size > 10000) groups.delete(groups.keys().next().value!);
        if (isA) {
          const value =
            rule.kind === "threshold" && rule.distinct
              ? field(e, rule.distinct)
              : e.id;
          w.values.set(value, (w.values.get(value) ?? 0) + 1);
          w.entries.splice(bound(w.entries, e.ts, true), 0, {
            ts: e.ts,
            id: e.id,
            value,
          });
          // A hard cap bounds memory even for a single noisy key.
          if (w.entries.length > 5000) expireFront(w, w.entries.length - 5000);
        }
        const end = bound(w.entries, e.ts, true);
        const count =
          rule.kind === "threshold" && rule.distinct
            ? end === w.entries.length
              ? w.values.size -
                Number(w.values.has(null)) -
                Number(w.values.has(undefined))
              : new Set(
                  w.entries
                    .slice(0, end)
                    .map((x) => x.value)
                    .filter((v) => v != null),
                ).size
            : end;
        const trigger = rule.kind === "sequence" ? isB : isA;
        if (trigger && count >= rule.threshold)
          this.alert(
            rule,
            key,
            e,
            [...w.entries.slice(0, Math.min(end, 100)).map((x) => x.id), e.id],
            values,
          );
      }
  }
  private alert(
    rule: Rule,
    key: string,
    e: Event,
    ids: number[],
    values: unknown[],
  ) {
    const now = Date.now();
    const suppress = rule.suppressMs ?? rule.windowMs ?? 600000;
    const result = this.db.transaction(() => {
      const existing = this.db
        .query(
          "SELECT id,last_seen FROM alerts WHERE rule_id=? AND group_key=? AND status IN ('open','acknowledged') AND last_seen BETWEEN ? AND ? ORDER BY last_seen DESC LIMIT 1",
        )
        .get(rule.id, key, e.ts - suppress, e.ts + suppress) as {
        id: number;
        last_seen: number;
      } | null;
      let id: number;
      if (existing) {
        id = existing.id;
        this.db
          .query(
            "UPDATE alerts SET count=count+1,first_seen=min(first_seen,?),last_seen=max(last_seen,?),updated_at=? WHERE id=?",
          )
          .run(e.ts, e.ts, now, id);
      } else {
        id = Number(
          this.db
            .query(
              "INSERT INTO alerts(rule_id,rule_name,severity,mitre,group_key,title,first_seen,last_seen,count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,'open',?,?)",
            )
            .run(
              rule.id,
              rule.name,
              rule.severity,
              rule.mitre,
              key,
              `${rule.name}: ${values.join(" / ")}`,
              e.ts,
              e.ts,
              now,
              now,
            ).lastInsertRowid,
        );
      }
      const count = (
        this.db
          .query("SELECT count(*) AS n FROM alert_events WHERE alert_id=?")
          .get(id) as { n: number }
      ).n;
      const insert = this.db.query(
        "INSERT OR IGNORE INTO alert_events VALUES(?,?)",
      );
      let left = 100 - count;
      for (const eventId of new Set(ids)) {
        if (left <= 0) break;
        left -= insert.run(id, eventId).changes;
      }
      return this.db.query("SELECT * FROM alerts WHERE id=?").get(id);
    })();
    this.publish(result);
  }
}
