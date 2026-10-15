import { expect, test } from "bun:test";
import { createApp } from "../src/server/api";
import { Bus } from "../src/server/bus";
import { parseLine, MAX_RAW_LINE_BYTES } from "../src/server/parsers";
import { parseSudo } from "../src/server/parsers/sudo";
import { config } from "../src/server/config";

test("hostile sudo lines are bounded and parse under 50 ms", () => {
  const raw = "alice : TTY=x ; PWD=" + " ".repeat(80000) + "!";
  const start = performance.now();
  const event = parseLine(raw);
  expect(performance.now() - start).toBeLessThan(50);
  expect(event.fields.truncated).toBe(true);
  expect(Buffer.byteLength(event.raw)).toBeLessThanOrEqual(MAX_RAW_LINE_BYTES);
  const direct = performance.now();
  expect(parseSudo(raw, {})).toBeNull();
  expect(performance.now() - direct).toBeLessThan(50);
});

test("HTTP and UDP shared ingest bounds raw including normalized items", async () => {
  const app = createApp();
  try {
    app.ingest([{ raw: "é".repeat(10000), source: "syslog" }]);
    const response = await app.fetch(new Request("http://local/api/ingest", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: "x".repeat(80000), message: "normalized" }),
    }));
    expect(response.status).toBe(200);
    const rows = app.db.query("SELECT raw,fields FROM events").all() as {raw:string;fields:string}[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Buffer.byteLength(row.raw)).toBeLessThanOrEqual(8192);
      expect(JSON.parse(row.fields).truncated).toBe(true);
    }
  } finally { app.close(); }
});

test("SSE caps subscribers at 50 and releases cancelled slots", async () => {
  const bus = new Bus();
  try {
    const streams = Array.from({ length: 50 }, () => bus.stream(new AbortController().signal));
    expect(bus.stream(new AbortController().signal).status).toBe(503);
    await streams[0]!.body!.cancel();
    expect(bus.stream(new AbortController().signal).status).toBe(200);
  } finally { bus.close(); }
});

test("SSE stalled readers are errored and queued data discarded at byte and message limits", async () => {
  for (const payload of ["x".repeat(200000), "x"]) {
    const bus = new Bus();
    try {
      const response = bus.stream(new AbortController().signal);
      for (let i = 0; i < 1100; i++) bus.alert(payload);
      const reader = response.body!.getReader();
      await expect(reader.read()).rejects.toThrow("fell behind");
      // An errored stream has no buffered messages left to drain.
      await expect(reader.read()).rejects.toThrow("fell behind");
      const streams = Array.from({ length: 50 }, () => bus.stream(new AbortController().signal));
      expect(streams.every(stream => stream.status === 200)).toBe(true);
    } finally { bus.close(); }
  }
});

test("mutation routes require JSON media types and matching Origin hosts", async () => {
  const app = createApp();
  try {
    for (const [path, method, body] of [
      ["/api/ingest", "POST", "{}"],
      ["/api/alerts/1", "PATCH", '{"status":"closed"}'],
      ["/api/rules/ssh-brute-force", "PATCH", '{"enabled":true}'],
    ]) {
      for (const type of [undefined, "text/plain", "application/x-www-form-urlencoded"]) {
        expect((await app.fetch(new Request("http://local" + path, {
          method, headers: type ? { "Content-Type": type } : {}, body,
        }))).status).toBe(415);
      }
      for (const origin of ["http://evil", "null", "http://local:9999"]) {
        expect((await app.fetch(new Request("http://local" + path, {
          method, headers: { "Content-Type": "application/json", Origin: origin }, body,
        }))).status).toBe(403);
      }
      for (const origin of [undefined, "http://local"]) {
        for (const type of ["application/json; charset=utf-8", "application/x-ndjson"]) {
          const response = await app.fetch(new Request("http://local" + path, {
            method, headers: { "Content-Type": type, ...(origin ? { Origin: origin } : {}) }, body,
          }));
          expect(response.status).toBe(path === "/api/alerts/1" ? 404 : 200);
        }
      }
    }
  } finally { app.close(); }
});

test("future timestamps cannot blind subsequent current SSH failures", () => {
  const app = createApp({ maxFutureSkewMs: 300000 });
  const now = Date.now();
  const event = { raw: "Failed password for alice from 192.0.2.1 port 22" };
  try {
    app.ingest([{ ...event, ts: now + 365 * 86400000 }]);
    app.ingest(Array.from({ length: 5 }, (_, i) => ({ ...event, ts: now - 5 + i })));
    expect(app.db.query("SELECT rule_id FROM alerts").all()).toEqual([{ rule_id: "ssh-brute-force" }]);
    expect(JSON.parse((app.db.query("SELECT fields FROM events ORDER BY id LIMIT 1").get() as {fields:string}).fields).future_ts).toBe(true);
    expect(app.db.query("SELECT count(*) AS n FROM events").get()).toEqual({ n: 6 });
  } finally { app.close(); }
});

test("future skew is configurable and boundary events remain eligible", () => {
  const previous = process.env.MAX_FUTURE_SKEW_MS;
  try {
    process.env.MAX_FUTURE_SKEW_MS = "42";
    expect(config().maxFutureSkewMs).toBe(42);
    process.env.MAX_FUTURE_SKEW_MS = "-1";
    expect(() => config()).toThrow("MAX_FUTURE_SKEW_MS");
  } finally {
    if (previous === undefined) delete process.env.MAX_FUTURE_SKEW_MS;
    else process.env.MAX_FUTURE_SKEW_MS = previous;
  }
  const app = createApp({ maxFutureSkewMs: 0 });
  try {
    app.ingest([{ ts: Date.now() - 1 }, { ts: Date.now() + 10000 }]);
    const rows = app.db.query("SELECT fields FROM events ORDER BY id").all() as {fields:string}[];
    expect(JSON.parse(rows[0]!.fields).future_ts).toBeUndefined();
    expect(JSON.parse(rows[1]!.fields).future_ts).toBe(true);
  } finally { app.close(); }
});

test("RFC3164 and RFC5424 accept LF and CRLF preserving raw without terminator", () => {
  for (const raw of [
    "<34>Oct 15 12:00:00 auth-01 sshd[42]: Failed password for alice from 192.0.2.1 port 22",
    "<34>1 2026-10-15T12:00:00Z auth-01 sshd 42 - - Failed password for alice from 192.0.2.1 port 22",
  ]) {
    for (const newline of ["\n", "\r\n"]) {
      expect(parseLine(raw + newline)).toMatchObject({ raw, source: "sshd", action: "login", outcome: "failure" });
    }
  }
});

test("invalid and pre-epoch syslog dates fall back to generic events at now", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  for (const raw of [
    "<34>1 bad auth-01 sshd 42 - - Failed password for alice from 192.0.2.1",
    "<34>1 1969-12-31T23:59:59Z auth-01 sshd 42 - - Failed password for alice from 192.0.2.1",
    "<34>Feb 31 12:00:00 auth-01 sshd[42]: Failed password for alice from 192.0.2.1",
    "<34>Apr 31 12:00:00 auth-01 sshd[42]: new user: name=bob",
  ]) {
    expect(parseLine(raw, { now, ts: 1 })).toMatchObject({ raw, message: raw, ts: now, category: "other", action: "log" });
  }
});


test("sudo split fields preserve command semicolons", () => {
  expect(parseSudo("alice : TTY=x ; PWD=/home/alice ; USER=root ; COMMAND=/bin/sh -c echo hi; echo bye", {}))
    .toMatchObject({ user: "alice", fields: { pwd: "/home/alice", target_user: "root", command: "/bin/sh -c echo hi; echo bye" } });
});
