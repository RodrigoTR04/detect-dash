import { test, expect } from "bun:test";
import { createApp } from "../src/server/api";
import { retain } from "../src/server/db";
function client(app: ReturnType<typeof createApp>) {
  return (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
}
test("ingest mixed batch, NDJSON, limits and malformed input", async () => {
  const app = createApp();
  const call = client(app);
  try {
    expect(
      await (
        await call("/api/ingest", [
          { message: "ok" },
          null,
          { severity: 9 },
          { raw: "unrecognized" },
        ])
      ).json(),
    ).toMatchObject({
      accepted: 2,
      rejected: 2,
      errors: [{ index: 1 }, { index: 2 }],
    });
    const nd = await app.fetch(
      new Request("http://local/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body: '{"message":"first"}\ninvalid\n{"raw":"Invalid user bob from 2001:db8::1","source":"sshd"}\n',
      }),
    );
    expect(await nd.json()).toMatchObject({ accepted: 2, rejected: 1 });
    expect(
      (
        await call(
          "/api/ingest",
          Array.from({ length: 5001 }, () => ({})),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await app.fetch(
          new Request("http://local/api/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "x".repeat(5 * 1024 * 1024 + 1),
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await app.fetch(
          new Request("http://local/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
        )
      ).status,
    ).toBe(400);
    expect(await (await call("/api/health")).json()).toMatchObject({
      ok: true,
      events_total: 4,
    });
  } finally {
    app.close();
  }
});
test("keyset pagination, filters, literal LIKE and parsed fields", async () => {
  const app = createApp();
  const call = client(app);
  const ts = Date.now();
  try {
    await call(
      "/api/ingest",
      Array.from({ length: 5 }, (_, i) => ({
        ts: ts - (i % 2),
        message: i === 0 ? "HELLO 100%_" : "hello world",
        category: "auth",
        source: "app",
        host: "h",
        user: "alice",
        src_ip: "10.0.0.1",
        outcome: "failure",
        severity: 2,
        fields: { i },
      })),
    );
    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const response = await call(
        `/api/events?from=${ts - 10}&to=${ts}&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as {
        events: { id: number; fields: object }[];
        next_cursor: string | null;
      };
      for (const e of page.events) {
        seen.push(e.id);
        expect(typeof e.fields).toBe("object");
      }
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual([5, 3, 1, 4, 2]);
    const filtered = (await (
      await call(
        `/api/events?from=${ts - 10}&to=${ts}&q=100%25_&category=auth&source=app&outcome=failure&severity_min=2&src_ip=10.0.0.1&user=alice&host=h`,
      )
    ).json()) as { events: unknown[] };
    expect(filtered.events).toHaveLength(1);
    expect((await call(`/api/events?q=HELLO`)).status).toBe(200);
    for (const query of [
      "limit=501",
      "limit=x",
      "severity_min=5",
      "category=no",
      "outcome=no",
      "cursor=bad",
      "from=2&to=1",
      "bucket=1",
      "limit=1&limit=2",
    ]) {
      expect((await call(`/api/events?${query}`)).status).toBe(400);
    }
    expect(await (await call("/api/events/1")).json()).toMatchObject({
      raw: expect.any(String),
      alerts: [],
    });
    expect((await call("/api/events/999")).status).toBe(404);
    expect((await call("/")).status).toBe(404);
  } finally {
    app.close();
  }
});
test("stats zero-fill, totals and bounds", async () => {
  const app = createApp();
  const call = client(app);
  try {
    await call("/api/ingest", [
      {
        ts: 1000,
        outcome: "failure",
        severity: 3,
        src_ip: "10.0.0.1",
        user: "alice",
      },
      { ts: 3000, outcome: "success" },
    ]);
    expect(
      await (await call("/api/stats?from=1000&to=180000&bucket=60000")).json(),
    ).toMatchObject({
      total: 2,
      by_severity: { 0: 1, 1: 0, 2: 0, 3: 1, 4: 0 },
      timeline: [
        { t: 0, total: 2, failure: 1 },
        { t: 60000, total: 0, failure: 0 },
        { t: 120000, total: 0, failure: 0 },
        { t: 180000, total: 0, failure: 0 },
      ],
      top_src_ips: [{ value: "10.0.0.1", count: 1 }],
    });
    expect((await call("/api/stats?bucket=0")).status).toBe(400);
    expect((await call("/api/stats?from=0&to=999999&bucket=1")).status).toBe(
      400,
    );
  } finally {
    app.close();
  }
});
test("alerts detail, status, rule toggles and retention cascades", async () => {
  const app = createApp();
  const call = client(app);
  try {
    await call("/api/ingest", [
      { raw: "Invalid user bob from 10.0.0.1", source: "sshd", ts: 1000 },
    ]);
    const list = (await (
      await call(
        "/api/alerts?status=open&severity_min=1&rule_id=invalid-user&limit=1",
      )
    ).json()) as { alerts: { id: number }[] };
    const id = list.alerts[0]!.id;
    expect(await (await call(`/api/alerts/${id}`)).json()).toMatchObject({
      mitre: "T1110.001",
      events: [{ user: "bob" }],
    });
    expect(
      await (
        await call(`/api/alerts/${id}`, { status: "closed" }, "PATCH")
      ).json(),
    ).toMatchObject({ status: "closed" });
    expect(
      (await call(`/api/alerts/${id}`, { status: "bad" }, "PATCH")).status,
    ).toBe(400);
    expect((await call("/api/alerts?status=bad")).status).toBe(400);
    expect(
      await (
        await call("/api/rules/invalid-user", { enabled: false }, "PATCH")
      ).json(),
    ).toMatchObject({ enabled: false });
    await call("/api/ingest", {
      raw: "Invalid user bob from 10.0.0.1",
      ts: 2000,
    });
    expect(app.db.query("SELECT * FROM alerts").all()).toHaveLength(1);
    const ruleList = (await (await call("/api/rules")).json()) as {
      rules: { id: string; enabled: boolean; alerts_total: number }[];
    };
    expect(ruleList.rules.find((r) => r.id === "invalid-user")).toMatchObject({
      enabled: false,
      alerts_total: 1,
    });
    retain(app.db, 1, 86400001 + 2000);
    expect(app.db.query("SELECT * FROM events").all()).toHaveLength(0);
    expect(app.db.query("SELECT * FROM alert_events").all()).toHaveLength(0);
    expect(app.db.query("SELECT * FROM alerts").all()).toHaveLength(0);
  } finally {
    app.close();
  }
});
test("SSE sends alerts and coalesced event batches, then disconnects", async () => {
  const app = createApp();
  const controller = new AbortController();
  try {
    const response = await app.fetch(
      new Request("http://local/api/stream", { signal: controller.signal }),
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain(
      ": connected",
    );
    app.ingest([{ raw: "Invalid user bob from 10.0.0.1" }]);
    expect(decoder.decode((await reader.read()).value)).toContain(
      "event: alert",
    );
    expect(decoder.decode((await reader.read()).value)).toContain(
      "event: events",
    );
    controller.abort();
    expect((await reader.read()).done).toBe(true);
  } finally {
    controller.abort();
    app.close();
  }
});

test("file-backed rules and alert suppression survive a restart", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "detect-dash-"));
  const path = join(directory, "test.db");
  let app = createApp({ dbPath: path });
  try {
    app.engine.setEnabled("web-scanning", false);
    app.ingest([
      { raw: "Invalid user bob from 10.0.0.1", ts: Date.now() - 1000 },
    ]);
    app.close();
    app = createApp({ dbPath: path });
    expect(app.engine.enabled("web-scanning")).toBe(false);
    app.ingest([{ raw: "Invalid user bob from 10.0.0.1", ts: Date.now() }]);
    expect(app.db.query("SELECT count FROM alerts").all()).toEqual([
      { count: 2 },
    ]);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SSE cancellation and app shutdown release streams", async () => {
  const app = createApp();
  const response = await app.fetch(new Request("http://local/api/stream"));
  await response.body!.cancel();
  const second = await app.fetch(new Request("http://local/api/stream"));
  const reader = second.body!.getReader();
  await reader.read();
  app.close();
  expect((await reader.read()).done).toBe(true);
});

test("alert summary counts current statuses across all time and rejects queries", async () => {
  const app = createApp();
  const call = client(app);
  try {
    expect(await (await call("/api/alerts/summary")).json()).toEqual({
      open: 0, acknowledged: 0, closed: 0, open_by_severity: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
    });
    for (const [i, status] of ["open", "open", "acknowledged", "closed"].entries()) {
      app.ingest([{ raw: `Invalid user bob from 10.0.0.${i + 1}`, source: "sshd", ts: 1000 + i }]);
      app.db.query("UPDATE alerts SET status=?,severity=? WHERE id=?").run(status!, i + 1, i + 1);
    }
    expect(await (await call("/api/alerts/summary")).json()).toEqual({
      open: 2, acknowledged: 1, closed: 1, open_by_severity: { 0: 0, 1: 1, 2: 1, 3: 0, 4: 0 },
    });
    expect((await call("/api/alerts/summary?status=open")).status).toBe(400);
    await call("/api/alerts/1", { status: "closed" }, "PATCH");
    expect(await (await call("/api/alerts/summary")).json()).toMatchObject({ open: 1, closed: 2 });
  } finally { app.close(); }
});
