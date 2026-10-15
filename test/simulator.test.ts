import { test, expect } from "bun:test";
import { Traffic } from "../scripts/simulate";
import { parseLine } from "../src/server/parsers";
import { normalize } from "../src/server/parsers/json";
import { openDatabase, insertEvents } from "../src/server/db";
import { DetectionEngine } from "../src/server/detection/engine";

test("simulator is seeded, weighted, timestamp-consistent and uses safe address ranges", () => {
  const start = new Date(2026, 9, 15, 12).getTime();
  const a = new Traffic(42, start),
    b = new Traffic(42, start);
  const counts = new Map<string, number>();
  const clients = new Set<string>();
  let headers = 0,
    system = 0;
  for (let i = 0; i < 10000; i++) {
    const ts = start + i * 1000;
    const e = a.benign(ts);
    expect(e).toEqual(b.benign(ts));
    const parsed = e.raw
      ? parseLine(e.raw, { ts: e.ts, now: ts })
      : normalize(e);
    expect(Math.abs(parsed.ts - ts)).toBeLessThan(1000);
    counts.set(parsed.source, (counts.get(parsed.source) ?? 0) + 1);
    if (["sshd", "sudo", "useradd"].includes(parsed.source)) {
      system++;
      if (e.raw && /^[A-Z][a-z]{2} /.test(e.raw)) headers++;
    }
    if (parsed.source === "nginx") clients.add(parsed.src_ip!);
    if (parsed.src_ip)
      expect(/^(10\.|192\.0\.2\.)/.test(parsed.src_ip)).toBe(true);
  }
  expect(counts.get("useradd")!).toBeLessThan(30);
  expect(counts.get("useradd")!).toBeGreaterThan(0);
  expect(counts.get("nginx")!).toBeGreaterThan(4500);
  expect(clients.size).toBe(30);
  expect(headers / system).toBeGreaterThan(0.27);
  expect(headers / system).toBeLessThan(0.33);
});

test("isolated benign typos never trigger SSH rules; scenarios span time and trigger every rule", () => {
  const start = Date.now() - 3600000;
  const traffic = new Traffic(7, start, 1e12);
  const db = openDatabase(":memory:");
  const engine = new DetectionEngine(db);
  const parsed = (e: ReturnType<Traffic["benign"]>) =>
    e.raw ? parseLine(e.raw, { ts: e.ts, now: e.ts }) : normalize(e);
  try {
    for (let i = 0; i < 3600; i++)
      engine.evaluate(
        insertEvents(db, traffic.tick(start + i * 1000, 20).map(parsed)),
      );
    expect(
      db
        .query(
          "SELECT * FROM alerts WHERE rule_id IN ('ssh-brute-force','password-spraying','brute-force-success')",
        )
        .all(),
    ).toHaveLength(0);
    const attackers = new Set<string>();
    for (let kind = 0; kind < 8; kind++) {
      const events = traffic
        .scenario(start + 3600000 + kind * 60000, kind)
        .map(parsed);
      if ([0, 1, 2, 3, 6, 7].includes(kind))
        expect(
          Math.max(...events.map((e) => e.ts)) -
            Math.min(...events.map((e) => e.ts)),
        ).toBeGreaterThan(15000);
      for (const e of events)
        if (e.src_ip) {
          expect(/^(203\.0\.113\.|198\.51\.100\.)/.test(e.src_ip)).toBe(true);
          attackers.add(e.src_ip);
        }
      if (kind === 7) expect(new Set(events.map((e) => e.host)).size).toBe(1);
      engine.evaluate(insertEvents(db, events));
    }
    expect(attackers.size).toBeGreaterThan(4);
    expect(db.query("SELECT DISTINCT rule_id FROM alerts").all()).toHaveLength(
      9,
    );
  } finally {
    db.close();
  }
});

test("scheduled attacks arrive gradually without future event timestamps", () => {
  const traffic = new Traffic(123, 1000000, 45);
  let attackTicks = 0;
  const ticks: number[] = [];
  for (let i = 0; i < 600; i++) {
    const now = 1000000 + i * 1000;
    const events = traffic.tick(now, 0);
    for (const e of events) expect(e.ts).toBeLessThanOrEqual(now);
    if (events.length) {
      attackTicks++;
      ticks.push(i);
    }
  }
  expect(attackTicks).toBeGreaterThan(50);
  expect(new Set(ticks.map((i) => Math.floor(i / 60))).size).toBeGreaterThan(4);
});
