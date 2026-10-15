import { test, expect } from "bun:test";
import { createApp } from "../src/server/api";
import { insertEvents, openDatabase, retain } from "../src/server/db";
import { normalize } from "../src/server/parsers/json";
import { random } from "../scripts/simulate";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("rollup stats equal direct event counts for seeded random data and partial minutes", async () => {
  const app = createApp();
  const rng = random(123);
  const start = Math.floor(Date.now() / 3600000) * 3600000 - 86400000;
  try {
    insertEvents(
      app.db,
      Array.from({ length: 12000 }, () =>
        normalize({
          ts: start + Math.floor(rng() * 86400000),
          category: ["auth", "web", "system"][Math.floor(rng() * 3)],
          source: ["sshd", "nginx", "app"][Math.floor(rng() * 3)],
          outcome: ["failure", "success", "unknown"][Math.floor(rng() * 3)],
          severity: Math.floor(rng() * 5),
          src_ip: `10.0.0.${Math.floor(rng() * 20)}`,
          user: `u${Math.floor(rng() * 12)}`,
        }),
      ),
    );
    for (const [from, to] of [
      [start, start + 86400000 - 1],
      [start + 54321, start + 22345678],
      [start + 5000, start + 8000],
    ]) {
      const response = await app.fetch(
        new Request(`http://local/api/stats?from=${from}&to=${to}`),
      );
      const stats = (await response.json()) as {
        total: number;
        bucket_ms: number;
        by_severity: object;
        by_category: object;
        by_outcome: object;
        timeline: { t: number; total: number; failure: number }[];
        top_src_ips: unknown[];
        top_users: unknown[];
        top_sources: unknown[];
      };
      expect(stats.total).toBe(
        (
          app.db
            .query("SELECT count(*) AS n FROM events WHERE ts BETWEEN ? AND ?")
            .get(from!, to!) as { n: number }
        ).n,
      );
      for (const column of ["severity", "category", "outcome"] as const) {
        const direct = app.db
          .query(
            `SELECT ${column} AS value,count(*) AS n FROM events WHERE ts BETWEEN ? AND ? GROUP BY 1`,
          )
          .all(from!, to!) as { value: string; n: number }[];
        expect(stats[`by_${column}`]).toMatchObject(
          Object.fromEntries(direct.map((r) => [r.value, r.n])),
        );
      }
      const direct = app.db
        .query(
          "SELECT CAST(ts/? AS INTEGER)*? AS t,count(*) AS total,sum(outcome='failure') AS failure FROM events WHERE ts BETWEEN ? AND ? GROUP BY 1",
        )
        .all(stats.bucket_ms, stats.bucket_ms, from!, to!) as {
        t: number;
        total: number;
        failure: number;
      }[];
      expect(stats.timeline.filter((r) => r.total)).toEqual(direct);
      for (const [column, key] of [
        ["src_ip", "top_src_ips"],
        ["user", "top_users"],
        ["source", "top_sources"],
      ] as const) {
        const low =
          column === "source" ? from! : Math.floor(from! / 3600000) * 3600000;
        const high =
          column === "source"
            ? to!
            : Math.floor(to! / 3600000) * 3600000 + 3599999;
        expect(stats[key]).toEqual(
          app.db
            .query(
              `SELECT ${column} AS value,count(*) AS count FROM events WHERE ts BETWEEN ? AND ? GROUP BY 1 ORDER BY count DESC,value LIMIT 10`,
            )
            .all(low, high),
        );
      }
    }
    const response = await app.fetch(
      new Request(
        `http://local/api/stats?from=${start}&to=${start + 86400000 - 1}`,
      ),
    );
    const stats = (await response.json()) as {
      timeline: unknown[];
      bucket_ms: number;
    };
    expect(stats.timeline.length).toBeGreaterThanOrEqual(60);
    expect(stats.timeline.length).toBeLessThanOrEqual(120);
    expect(stats.bucket_ms).toBe(900000);
    expect(
      (await app.fetch(new Request("http://local/api/stats?bucket=61000")))
        .status,
    ).toBe(400);
  } finally {
    app.close();
  }
});

test("startup retention removes expired events and rollups, preserves partial cutoff counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-"));
  const path = join(dir, "db");
  const now = Date.now();
  const db = openDatabase(path);
  insertEvents(db, [
    normalize({ ts: now - 2 * 86400000, user: "old", src_ip: "10.0.0.1" }),
    normalize({ ts: now, user: "new", src_ip: "10.0.0.2" }),
  ]);
  db.close();
  const app = createApp({ dbPath: path, retentionDays: 1 });
  try {
    expect(app.db.query("SELECT user FROM events").all()).toEqual([
      { user: "new" },
    ]);
    expect(
      app.db.query("SELECT sum(count) AS n FROM event_rollup").get(),
    ).toEqual({ n: 1 });
    expect(
      app.db.query("SELECT value FROM entity_rollup ORDER BY value").all(),
    ).toEqual([{ value: "10.0.0.2" }, { value: "new" }]);
    insertEvents(app.db, [
      normalize({ ts: now - 1 }),
      normalize({ ts: now + 1 }),
    ]);
    retain(app.db, 1, now + 86400000);
    expect(
      app.db.query("SELECT sum(count) AS n FROM event_rollup").get(),
    ).toEqual({ n: 2 });
  } finally {
    app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing databases populate rollups once on migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollup-migrate-"));
  const path = join(dir, "db");
  let db = openDatabase(path);
  try {
    insertEvents(db, [normalize({ ts: 123, user: "alice" })]);
    db.exec("DROP TABLE event_rollup; DROP TABLE entity_rollup");
    db.close();
    db = openDatabase(path);
    expect(db.query("SELECT count FROM event_rollup").all()).toEqual([
      { count: 1 },
    ]);
    expect(db.query("SELECT count FROM entity_rollup").all()).toEqual([
      { count: 1 },
    ]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted migration with empty existing rollups rebuilds before marking schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollup-interrupted-"));
  const path = join(dir, "db");
  let db = openDatabase(path);
  try {
    insertEvents(db, [normalize({ ts: 123, user: "alice", src_ip: "192.0.2.1" })]);
    db.exec("DELETE FROM event_rollup; DELETE FROM entity_rollup; PRAGMA user_version=0");
    db.close();
    db = openDatabase(path);
    expect(db.query("SELECT count FROM event_rollup").all()).toEqual([{ count: 1 }]);
    expect(db.query("SELECT value,count FROM entity_rollup ORDER BY value").all()).toEqual([
      { value: "192.0.2.1", count: 1 }, { value: "alice", count: 1 },
    ]);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    db.close();
    db = openDatabase(path);
    expect(db.query("SELECT count FROM event_rollup").all()).toEqual([{ count: 1 }]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
