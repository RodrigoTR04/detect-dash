import { openDatabase, eventRow, retain } from "./db";
import { Bus } from "./bus";
import { DetectionEngine } from "./detection/engine";
import { HttpError, ingestItems, ingestRequest, readBody } from "./ingest";
import { categories, outcomes } from "./schema";
import type { SQLQueryBindings } from "bun:sqlite";
const json = (data: unknown, status = 200) => Response.json(data, { status });
function number(
  raw: string | null,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw))
    throw new HttpError(400, "expected a nonnegative integer");
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new HttpError(400, "number out of range");
  return n;
}
function allowed(p: URLSearchParams, keys: string[]) {
  for (const key of p.keys()) {
    if (!keys.includes(key))
      throw new HttpError(400, `unknown query parameter: ${key}`);
    if (p.getAll(key).length !== 1)
      throw new HttpError(400, `duplicate parameter: ${key}`);
  }
}
function range(p: URLSearchParams) {
  const now = Date.now();
  const from = number(p.get("from"), now - 86400000);
  const to = number(p.get("to"), now);
  if (from > to) throw new HttpError(400, "from must be <= to");
  return { from, to };
}
function cursor(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      !v.every((x) => Number.isSafeInteger(x) && x >= 0)
    )
      throw Error();
    return v;
  } catch {
    throw new HttpError(400, "invalid cursor");
  }
}
function paginate(
  rows: Record<string, unknown>[],
  limit: number,
  timeField: string,
) {
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      more && last
        ? Buffer.from(JSON.stringify([last[timeField], last.id])).toString(
            "base64url",
          )
        : null,
  };
}
export function createApp(
  options: { dbPath?: string; retentionDays?: number; maxFutureSkewMs?: number } = {},
) {
  const db = openDatabase(options.dbPath ?? ":memory:");
  retain(db, options.retentionDays ?? 7);
  const bus = new Bus();
  const engine = new DetectionEngine(db, undefined, bus.alert);
  const started = Date.now();
  const retention = setInterval(
    () => retain(db, options.retentionDays ?? 7),
    3600000,
  );
  retention.unref();
  const getEvent = (id: number) => {
    const row = db.query("SELECT * FROM events WHERE id=?").get(id);
    return row ? eventRow(row) : null;
  };
  async function fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const p = url.searchParams;
      const method = request.method;
      if ((method === "POST" || method === "PATCH") &&
          (path === "/api/ingest" || /^\/api\/(alerts|rules)\/[^/]+$/.test(path))) {
        const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (type !== "application/json" && type !== "application/x-ndjson")
          throw new HttpError(415, "Content-Type must be application/json or application/x-ndjson");
        const origin = request.headers.get("origin");
        if (origin) {
          let host: string;
          try { host = new URL(origin).host; } catch { throw new HttpError(403, "invalid Origin"); }
          if (host !== (request.headers.get("host") ?? url.host))
            throw new HttpError(403, "cross-origin writes are forbidden");
        }
      }
      if (path === "/api/ingest" && method === "POST") {
        allowed(p, []);
        return json(await ingestRequest(request, db, engine, bus, options.maxFutureSkewMs));
      }
      if (path === "/api/health" && method === "GET") {
        allowed(p, []);
        return json({
          ok: true,
          uptime_s: Math.floor((Date.now() - started) / 1000),
          events_total: (
            db.query("SELECT count(*) AS n FROM events").get() as { n: number }
          ).n,
        });
      }
      if (path === "/api/stream" && method === "GET") {
        allowed(p, []);
        return bus.stream(request.signal);
      }
      if (path === "/api/events" && method === "GET") {
        allowed(p, [
          "from",
          "to",
          "q",
          "category",
          "source",
          "outcome",
          "severity_min",
          "src_ip",
          "user",
          "host",
          "limit",
          "cursor",
        ]);
        const { from, to } = range(p);
        const args: SQLQueryBindings[] = [from, to];
        const where = ["ts>=?", "ts<=?"];
        for (const key of [
          "category",
          "source",
          "outcome",
          "src_ip",
          "user",
          "host",
        ])
          if (p.has(key)) {
            const v = p.get(key)!;
            if (
              !v ||
              v.length > 1024 ||
              (key === "category" && !categories.includes(v as never)) ||
              (key === "outcome" && !outcomes.includes(v as never))
            )
              throw new HttpError(400, `invalid ${key}`);
            where.push(`${key}=?`);
            args.push(v);
          }
        if (p.has("severity_min")) {
          where.push("severity>=?");
          args.push(number(p.get("severity_min"), 0, 0, 4));
        }
        if (p.has("q")) {
          const q = p.get("q")!;
          if (q.length > 4096) throw new HttpError(400, "q too long");
          where.push("message LIKE ? ESCAPE '\\'");
          args.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
        }
        const c = cursor(p.get("cursor"));
        if (c) {
          where.push("(ts<? OR (ts=? AND id<?))");
          args.push(c[0]!, c[0]!, c[1]!);
        }
        const limit = number(p.get("limit"), 100, 1, 500);
        args.push(limit + 1);
        const rows = db
          .query(
            `SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY ts DESC,id DESC LIMIT ?`,
          )
          .all(...args) as Record<string, unknown>[];
        const result = paginate(rows, limit, "ts");
        return json({
          events: result.items.map(eventRow),
          next_cursor: result.next_cursor,
        });
      }
      const eventId = /^\/api\/events\/(\d+)$/.exec(path);
      if (eventId && method === "GET") {
        allowed(p, []);
        const event = getEvent(number(eventId[1]!, 0, 1));
        if (!event) throw new HttpError(404, "event not found");
        return json({
          ...event,
          alerts: db
            .query(
              "SELECT a.* FROM alerts a JOIN alert_events ae ON ae.alert_id=a.id WHERE ae.event_id=?",
            )
            .all(event.id),
        });
      }
      if (path === "/api/stats" && method === "GET") {
        allowed(p, ["from", "to", "bucket"]);
        const { from, to } = range(p);
        const nice = [
          60000, 300000, 900000, 1800000, 3600000, 10800000, 21600000, 43200000,
          86400000,
        ];
        const ideal = (to - from + 1) / 90;
        const defaultBucket = nice.reduce((best, n) =>
          Math.abs(Math.log(n / ideal)) < Math.abs(Math.log(best / ideal))
            ? n
            : best,
        );
        const bucket = number(p.get("bucket"), defaultBucket, 60000);
        if (bucket % 60000)
          throw new HttpError(400, "bucket must be a multiple of 60000");
        if (Math.floor(to / bucket) - Math.floor(from / bucket) > 10000)
          throw new HttpError(400, "too many buckets");
        // Full minutes come from rollups; at most two partial minutes use events.
        const fullFrom = Math.ceil(from / 60000) * 60000;
        const fullTo = Math.floor((to + 1) / 60000) * 60000;
        const rows = db
          .query(
            `WITH exact AS MATERIALIZED (
          SELECT minute,category,source,outcome,severity,count FROM event_rollup WHERE minute>=? AND minute<?
          UNION ALL SELECT CAST(ts/60000 AS INTEGER)*60000,category,source,outcome,severity,1 FROM events WHERE ts>=? AND ts<?
          UNION ALL SELECT CAST(ts/60000 AS INTEGER)*60000,category,source,outcome,severity,1 FROM events WHERE ts>=? AND ts<?)
          SELECT 'severity' AS kind,CAST(severity AS TEXT) AS value,sum(count) AS count,0 AS failure FROM exact GROUP BY severity
          UNION ALL SELECT 'category',category,sum(count),0 FROM exact GROUP BY category
          UNION ALL SELECT 'outcome',outcome,sum(count),0 FROM exact GROUP BY outcome
          UNION ALL SELECT 'source',source,sum(count),0 FROM exact GROUP BY source
          UNION ALL SELECT 'time',CAST(CAST(minute/? AS INTEGER)*? AS TEXT),sum(count),sum(CASE WHEN outcome='failure' THEN count ELSE 0 END) FROM exact GROUP BY CAST(minute/? AS INTEGER)
        `,
          )
          .all(
            fullFrom,
            fullTo,
            from,
            Math.min(to + 1, fullFrom),
            Math.max(from, fullFrom, fullTo),
            to + 1,
            bucket,
            bucket,
            bucket,
          ) as {
          kind: string;
          value: string;
          count: number;
          failure: number;
        }[];
        const severity: Record<string, number> = {
          0: 0,
          1: 0,
          2: 0,
          3: 0,
          4: 0,
        };
        const category: Record<string, number> = Object.fromEntries(
          categories.map((x) => [x, 0]),
        );
        const outcome: Record<string, number> = {
          success: 0,
          failure: 0,
          unknown: 0,
        };
        const sources = new Map<string, number>();
        const byTime = new Map<
          number,
          { t: number; total: number; failure: number }
        >();
        let total = 0;
        for (const r of rows) {
          if (r.kind === "severity") severity[r.value] = r.count;
          else if (r.kind === "category") category[r.value] = r.count;
          else if (r.kind === "outcome") outcome[r.value] = r.count;
          else if (r.kind === "source") sources.set(r.value, r.count);
          else {
            const t = Number(r.value);
            total += r.count;
            byTime.set(t, { t, total: r.count, failure: r.failure });
          }
        }
        const timeline = [];
        for (let t = Math.floor(from / bucket) * bucket; t <= to; t += bucket)
          timeline.push(byTime.get(t) ?? { t, total: 0, failure: 0 });
        const top = (kind: string) =>
          db
            .query(
              "SELECT value,sum(count) AS count FROM entity_rollup WHERE hour BETWEEN ? AND ? AND kind=? GROUP BY value ORDER BY count DESC,value LIMIT 10",
            )
            .all(
              Math.floor(from / 3600000) * 3600000,
              Math.floor(to / 3600000) * 3600000,
              kind,
            );
        const alertCounts = db
          .query(
            "SELECT severity,count(*) AS n FROM alerts WHERE first_seen<=? AND last_seen>=? GROUP BY severity",
          )
          .all(to, from) as { severity: number; n: number }[];
        return json({
          total,
          bucket_ms: bucket,
          by_severity: severity,
          by_category: category,
          by_outcome: outcome,
          timeline,
          top_src_ips: top("src_ip"),
          top_users: top("user"),
          top_sources: [...sources]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
            .slice(0, 10),
          alerts_open: (
            db
              .query(
                "SELECT count(*) AS n FROM alerts WHERE status='open' AND first_seen<=? AND last_seen>=?",
              )
              .get(to, from) as { n: number }
          ).n,
          alerts_by_severity: {
            0: 0,
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            ...Object.fromEntries(alertCounts.map((x) => [x.severity, x.n])),
          },
        });
      }
      if (path === "/api/alerts" && method === "GET") {
        allowed(p, ["status", "severity_min", "rule_id", "limit", "cursor"]);
        const where = ["1=1"];
        const args: SQLQueryBindings[] = [];
        if (p.has("status")) {
          const status = p.get("status")!;
          if (!["open", "acknowledged", "closed"].includes(status))
            throw new HttpError(400, "invalid status");
          where.push("status=?");
          args.push(status);
        }
        if (p.has("severity_min")) {
          where.push("severity>=?");
          args.push(number(p.get("severity_min"), 0, 0, 4));
        }
        if (p.has("rule_id")) {
          if (!engine.rules.some((r) => r.id === p.get("rule_id")))
            throw new HttpError(400, "invalid rule_id");
          where.push("rule_id=?");
          args.push(p.get("rule_id"));
        }
        const c = cursor(p.get("cursor"));
        if (c) {
          where.push("(last_seen<? OR (last_seen=? AND id<?))");
          args.push(c[0]!, c[0]!, c[1]!);
        }
        const limit = number(p.get("limit"), 100, 1, 500);
        args.push(limit + 1);
        const result = paginate(
          db
            .query(
              `SELECT * FROM alerts WHERE ${where.join(" AND ")} ORDER BY last_seen DESC,id DESC LIMIT ?`,
            )
            .all(...args) as Record<string, unknown>[],
          limit,
          "last_seen",
        );
        return json({ alerts: result.items, next_cursor: result.next_cursor });
      }
      if (path === "/api/alerts/summary" && method === "GET") {
        allowed(p, []);
        const summary = {
          open: 0, acknowledged: 0, closed: 0,
          open_by_severity: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 } as Record<string, number>,
        };
        const counts = db.query("SELECT status,severity,count(*) AS n FROM alerts GROUP BY status,severity").all() as {
          status: "open" | "acknowledged" | "closed"; severity: number; n: number;
        }[];
        for (const row of counts) {
          summary[row.status] += row.n;
          if (row.status === "open") summary.open_by_severity[row.severity] = row.n;
        }
        return json(summary);
      }
      const alertId = /^\/api\/alerts\/(\d+)$/.exec(path);
      if (alertId && (method === "GET" || method === "PATCH")) {
        allowed(p, []);
        const id = number(alertId[1]!, 0, 1);
        if (!db.query("SELECT id FROM alerts WHERE id=?").get(id))
          throw new HttpError(404, "alert not found");
        if (method === "PATCH") {
          const body = await objectBody(request);
          if (
            Object.keys(body).some((k) => k !== "status") ||
            !["open", "acknowledged", "closed"].includes(String(body.status))
          )
            throw new HttpError(400, "invalid status");
          db.query("UPDATE alerts SET status=?,updated_at=? WHERE id=?").run(
            String(body.status),
            Date.now(),
            id,
          );
          bus.alert(db.query("SELECT * FROM alerts WHERE id=?").get(id));
        }
        const alert = db
          .query("SELECT * FROM alerts WHERE id=?")
          .get(id) as Record<string, unknown>;
        return json({
          ...alert,
          events: db
            .query(
              "SELECT e.* FROM events e JOIN alert_events ae ON ae.event_id=e.id WHERE ae.alert_id=? ORDER BY e.ts,e.id",
            )
            .all(id)
            .map(eventRow),
        });
      }
      if (path === "/api/rules" && method === "GET") {
        allowed(p, []);
        return json({
          rules: engine.rules.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            kind: r.kind,
            severity: r.severity,
            mitre: r.mitre,
            enabled: engine.enabled(r.id),
            alerts_total: (
              db
                .query("SELECT count(*) AS n FROM alerts WHERE rule_id=?")
                .get(r.id) as { n: number }
            ).n,
            alerts_open: (
              db
                .query(
                  "SELECT count(*) AS n FROM alerts WHERE rule_id=? AND status='open'",
                )
                .get(r.id) as { n: number }
            ).n,
          })),
        });
      }
      const ruleId = /^\/api\/rules\/([^/]+)$/.exec(path);
      if (ruleId && method === "PATCH") {
        allowed(p, []);
        const id = ruleId[1]!;
        if (!engine.rules.some((r) => r.id === id))
          throw new HttpError(404, "rule not found");
        const body = await objectBody(request);
        if (
          typeof body.enabled !== "boolean" ||
          Object.keys(body).some((k) => k !== "enabled")
        )
          throw new HttpError(400, "enabled must be boolean");
        engine.setEnabled(id, body.enabled);
        return json({ id, enabled: body.enabled });
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "internal server error" }, 500);
    }
  }
  return {
    fetch,
    db,
    engine,
    ingest: (items: unknown[]) => ingestItems(items, db, engine, bus, options.maxFutureSkewMs),
    close: () => {
      clearInterval(retention);
      bus.close();
      db.close();
    },
  };
}
async function objectBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(await readBody(request));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "expected object");
  return value as Record<string, unknown>;
}
