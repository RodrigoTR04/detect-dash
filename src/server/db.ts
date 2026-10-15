import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Event, NormalizedEventInput } from "./schema";
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  const missingRollups = db.query("SELECT name FROM sqlite_master WHERE name IN ('event_rollup', 'entity_rollup')").all().length !== 2;
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, ingested_at INTEGER NOT NULL,
        source TEXT NOT NULL, host TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('auth','network','process','web','system','other')),
        action TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('success','failure','unknown')), severity INTEGER NOT NULL CHECK(severity BETWEEN 0 AND 4),
        src_ip TEXT, dst_ip TEXT, user TEXT, message TEXT NOT NULL, fields TEXT NOT NULL, raw TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
      CREATE INDEX IF NOT EXISTS events_ip_ts ON events(src_ip,ts);
      CREATE INDEX IF NOT EXISTS events_user_ts ON events(user,ts);
      CREATE INDEX IF NOT EXISTS events_category_ts ON events(category,ts);
      CREATE INDEX IF NOT EXISTS events_source_ts ON events(source,ts);
      CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, rule_id TEXT NOT NULL, rule_name TEXT NOT NULL, severity INTEGER NOT NULL CHECK(severity BETWEEN 0 AND 4), mitre TEXT NOT NULL,
        group_key TEXT NOT NULL, title TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, count INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','acknowledged','closed')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS alerts_group ON alerts(rule_id,group_key,status,last_seen);
      CREATE TABLE IF NOT EXISTS alert_events (alert_id INTEGER REFERENCES alerts(id) ON DELETE CASCADE, event_id INTEGER REFERENCES events(id) ON DELETE CASCADE, PRIMARY KEY(alert_id,event_id));
      CREATE TABLE IF NOT EXISTS event_rollup (minute INTEGER NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL, outcome TEXT NOT NULL, severity INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(minute,category,source,outcome,severity)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS entity_rollup (hour INTEGER NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(hour,kind,value)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS rule_state (rule_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));`);
    if (version < 1 || missingRollups) {
      db.exec("DELETE FROM event_rollup; DELETE FROM entity_rollup");
      db.exec(
        "INSERT INTO event_rollup SELECT CAST(ts/60000 AS INTEGER)*60000,category,source,outcome,severity,count(*) FROM events GROUP BY 1,2,3,4,5",
      );
      for (const kind of ["src_ip", "user"])
        db.exec(
          `INSERT INTO entity_rollup SELECT CAST(ts/3600000 AS INTEGER)*3600000,'${kind}',${kind},count(*) FROM events WHERE ${kind} IS NOT NULL GROUP BY 1,3`,
        );
    }
    if (version < 1) db.exec("PRAGMA user_version=1");
  })();
  return db;
}
export type DB = ReturnType<typeof openDatabase>;
export function eventRow(row: unknown): Event {
  const value = row as Event & { fields: string };
  return { ...value, fields: JSON.parse(value.fields) };
}
export function insertEvents(db: DB, inputs: NormalizedEventInput[]): Event[] {
  const insert = db.query(
    `INSERT INTO events(ts,ingested_at,source,host,category,action,outcome,severity,src_ip,dst_ip,user,message,fields,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
  );
  const rollup = db.query(
    "INSERT INTO event_rollup VALUES(?,?,?,?,?,?) ON CONFLICT(minute,category,source,outcome,severity) DO UPDATE SET count=count+excluded.count",
  );
  const entity = db.query(
    "INSERT INTO entity_rollup VALUES(?,?,?,?) ON CONFLICT(hour,kind,value) DO UPDATE SET count=count+excluded.count",
  );
  return db.transaction(() => {
    // Aggregate each batch before touching the rollup indexes.
    const minutes = new Map<
      string,
      { e: NormalizedEventInput; count: number }
    >();
    const entities = new Map<
      string,
      { hour: number; kind: string; value: string; count: number }
    >();
    const events = inputs.map((e) => {
      const minute = Math.floor(e.ts / 60000) * 60000;
      const key = JSON.stringify([
        minute,
        e.category,
        e.source,
        e.outcome,
        e.severity,
      ]);
      const row = minutes.get(key);
      if (row) row.count++;
      else minutes.set(key, { e, count: 1 });
      for (const kind of ["src_ip", "user"] as const) {
        const value = e[kind];
        if (value === null) continue;
        const hour = Math.floor(e.ts / 3600000) * 3600000;
        const k = JSON.stringify([hour, kind, value]);
        const r = entities.get(k);
        if (r) r.count++;
        else entities.set(k, { hour, kind, value, count: 1 });
      }
      return eventRow(
        insert.get(
          e.ts,
          Date.now(),
          e.source,
          e.host,
          e.category,
          e.action,
          e.outcome,
          e.severity,
          e.src_ip,
          e.dst_ip,
          e.user,
          e.message,
          JSON.stringify(e.fields),
          e.raw,
        ),
      );
    });
    for (const { e, count } of minutes.values())
      rollup.run(
        Math.floor(e.ts / 60000) * 60000,
        e.category,
        e.source,
        e.outcome,
        e.severity,
        count,
      );
    for (const r of entities.values())
      entity.run(r.hour, r.kind, r.value, r.count);
    return events;
  })();
}

export function retain(db: DB, days: number, now = Date.now()) {
  const cutoff = now - days * 86400000;
  db.transaction(() => {
    // Rebuild the partial cutoff minute/hour so future stats remain exact.
    const minute = Math.floor(cutoff / 60000) * 60000;
    const hour = Math.floor(cutoff / 3600000) * 3600000;
    db.query("DELETE FROM event_rollup WHERE minute<=?").run(minute);
    db.query("DELETE FROM entity_rollup WHERE hour<=?").run(hour);
    db.query("DELETE FROM events WHERE ts < ?").run(cutoff);
    db.query(
      "INSERT INTO event_rollup SELECT CAST(ts/60000 AS INTEGER)*60000,category,source,outcome,severity,count(*) FROM events WHERE ts>=? AND ts<? GROUP BY 1,2,3,4,5",
    ).run(cutoff, minute + 60000);
    for (const kind of ["src_ip", "user"])
      db.query(
        `INSERT INTO entity_rollup SELECT CAST(ts/3600000 AS INTEGER)*3600000,?,${kind},count(*) FROM events WHERE ts>=? AND ts<? AND ${kind} IS NOT NULL GROUP BY 1,3`,
      ).run(kind, cutoff, hour + 3600000);
    db.query(
      "DELETE FROM alerts WHERE status = 'closed' AND last_seen < ?",
    ).run(cutoff);
  })();
}
