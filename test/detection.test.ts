import { test, expect } from "bun:test";
import { openDatabase, insertEvents } from "../src/server/db";
import { DetectionEngine, matches } from "../src/server/detection/engine";
import { rules, type Rule } from "../src/server/detection/rules";
import { normalize } from "../src/server/parsers/json";
const event = (ts: number, user = "alice", outcome = "failure") =>
  normalize({
    ts,
    user,
    outcome,
    action: "login",
    source: "sshd",
    src_ip: "203.0.113.1",
    fields: { status: 404, path: "/%2e%2e/etc/passwd" },
  });
test("declarative conditions", () => {
  const e = { ...event(100), id: 1, ingested_at: 100 };
  expect(
    matches(e, {
      all: [
        { field: "source", op: "equals", value: "sshd" },
        {
          any: [
            { field: "fields.status", op: "gte", value: 400 },
            { field: "user", op: "in", value: ["bob"] },
          ],
        },
        { not: { field: "fields.status", op: "lte", value: 399 } },
        { field: "fields.path", op: "regex", value: "\\.\\./", decode: true },
      ],
    }),
  ).toBe(true);
  expect(matches(e, { field: "missing", op: "gte", value: 0 })).toBe(false);
});
test("threshold expiry, distinct counting, suppression, closed alerts", () => {
  const db = openDatabase(":memory:");
  const selected = rules.filter((r) =>
    ["ssh-brute-force", "password-spraying"].includes(r.id),
  );
  const engine = new DetectionEngine(db, selected);
  const push = (ts: number, user = "alice") =>
    engine.evaluate(insertEvents(db, [event(ts, user)]));
  try {
    for (let i = 0; i < 4; i++) push(1000 + i);
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(0);
    push(400000);
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(0);
    for (let i = 0; i < 4; i++) push(400001 + i);
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(1);
    push(400006);
    expect(db.query("SELECT count FROM alerts").get()).toMatchObject({
      count: 2,
    });
    for (let i = 0; i < 4; i++) push(400010 + i, `user${i}`);
    expect(
      db.query("SELECT * FROM alerts WHERE rule_id='password-spraying'").all(),
    ).toHaveLength(1);
    db.exec("UPDATE alerts SET status='closed'");
    push(400020);
    expect(
      db.query("SELECT * FROM alerts WHERE rule_id='ssh-brute-force'").all(),
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});
test("sequence orders batches and expires", () => {
  const db = openDatabase(":memory:");
  const engine = new DetectionEngine(
    db,
    rules.filter((r) => r.kind === "sequence"),
  );
  try {
    engine.evaluate(
      insertEvents(db, [
        event(104, "alice", "success"),
        event(103),
        event(101),
        event(102),
      ]),
    );
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(1);
    engine.evaluate(insertEvents(db, [event(2000000, "alice", "success")]));
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(1);
  } finally {
    db.close();
  }
});
test("match, enable toggle, suppression timeout and evidence cap", () => {
  const db = openDatabase(":memory:");
  const rule: Rule = {
    id: "test",
    name: "Test",
    description: "test",
    mitre: "T1",
    kind: "match",
    severity: 1,
    groupBy: ["src_ip"],
    suppressMs: 100,
    condition: { field: "source", op: "equals", value: "sshd" },
  };
  const engine = new DetectionEngine(db, [rule]);
  try {
    engine.evaluate(
      insertEvents(
        db,
        Array.from({ length: 130 }, (_, i) => event(1000 + i)),
      ),
    );
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(1);
    expect(db.query("SELECT * FROM alert_events").all()).toHaveLength(100);
    engine.evaluate(insertEvents(db, [event(2000)]));
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(2);
    engine.setEnabled("test", false);
    engine.evaluate(insertEvents(db, [event(3000)]));
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(2);
  } finally {
    db.close();
  }
});
test("all built-in rules trigger on representative events", () => {
  const examples: Record<string, unknown[]> = {
    "ssh-brute-force": Array.from({ length: 5 }, () => ({
      action: "login",
      source: "sshd",
      outcome: "failure",
    })),
    "password-spraying": Array.from({ length: 5 }, (_, i) => ({
      action: "login",
      source: "sshd",
      outcome: "failure",
      user: `u${i}`,
    })),
    "brute-force-success": [
      ...Array.from({ length: 3 }, () => ({
        action: "login",
        source: "sshd",
        outcome: "failure",
      })),
      { source: "sshd", action: "login", outcome: "success" },
    ],
    "invalid-user": [{ source: "sshd", fields: { invalid_user: true } }],
    "sudo-failures": Array.from({ length: 3 }, () => ({
      action: "sudo",
      source: "sudo",
      outcome: "failure",
    })),
    "privileged-group": [{ action: "group_add", fields: { group: "sudo" } }],
    "web-scanning": Array.from({ length: 20 }, () => ({
      category: "web",
      fields: { status: 404 },
    })),
    "web-attack": [{ category: "web", fields: { path: "/%2e%2e/etc/passwd" } }],
    "server-errors": Array.from({ length: 10 }, () => ({
      category: "web",
      fields: { status: 503 },
    })),
  };
  for (const rule of rules) {
    const db = openDatabase(":memory:");
    try {
      const engine = new DetectionEngine(db, [rule]);
      engine.evaluate(
        insertEvents(
          db,
          examples[rule.id]!.map((x, i) =>
            normalize({
              ts: 100 + i,
              src_ip: "10.0.0.1",
              user: "alice",
              host: "host",
              ...(x as object),
            }),
          ),
        ),
      );
      expect(db.query("SELECT * FROM alerts").all().length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  }
});

test("late events inside a window count, distinct values expire", () => {
  const db = openDatabase(":memory:");
  const rule: Rule = {
    id: "distinct",
    name: "Distinct",
    description: "test",
    kind: "threshold",
    severity: 2,
    mitre: "T1",
    groupBy: ["src_ip"],
    windowMs: 100,
    threshold: 2,
    distinct: "user",
    condition: { field: "source", op: "equals", value: "sshd" },
  };
  const engine = new DetectionEngine(db, [rule]);
  try {
    engine.evaluate(insertEvents(db, [event(1000, "alice")]));
    engine.evaluate(insertEvents(db, [event(990, "bob")]));
    // At 990, the event at 1000 is in the future and must not count.
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(0);
    engine.evaluate(insertEvents(db, [event(1001, "alice")]));
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(1);
    engine.evaluate(insertEvents(db, [event(1200, "carol")]));
    expect(db.query("SELECT count FROM alerts").get()).toEqual({ count: 1 });
    engine.evaluate(insertEvents(db, [event(1201, "dan")]));
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("SSH companion lines do not multiply attempts; invalid usernames share IP evidence", async () => {
  const { parseLine } = await import("../src/server/parsers");
  const db = openDatabase(":memory:");
  const engine = new DetectionEngine(db);
  const push = (raw: string, ts: number) =>
    engine.evaluate(insertEvents(db, [parseLine(raw, { ts })]));
  try {
    for (let i = 0; i < 4; i++) {
      push(`Invalid user spray${i} from 203.0.113.1 port 22`, 100 + i * 10);
      push(
        `Failed keyboard-interactive/pam for invalid user spray${i} from 203.0.113.1 port 22`,
        101 + i * 10,
      );
      push(
        `pam_unix(sshd:auth): authentication failure; rhost=203.0.113.1 user=spray${i}`,
        102 + i * 10,
      );
      push(
        `Disconnected from user spray${i} 203.0.113.1 port 22`,
        103 + i * 10,
      );
    }
    expect(
      db.query("SELECT * FROM alerts WHERE rule_id='ssh-brute-force'").all(),
    ).toHaveLength(0);
    expect(
      db.query("SELECT * FROM alerts WHERE rule_id='invalid-user'").all(),
    ).toHaveLength(1);
    expect(
      db
        .query(
          "SELECT DISTINCT user FROM events JOIN alert_events ON events.id=event_id",
        )
        .all(),
    ).toHaveLength(4);
    push("Failed publickey for root from 203.0.113.1 port 22", 200);
    expect(
      db
        .query("SELECT count FROM alerts WHERE rule_id='ssh-brute-force'")
        .get(),
    ).toEqual({ count: 1 });
    db.exec("UPDATE alerts SET status='acknowledged'");
    push("Failed password for root from 203.0.113.1 port 22", 201);
    expect(
      db
        .query(
          "SELECT count,status FROM alerts WHERE rule_id='ssh-brute-force'",
        )
        .all(),
    ).toEqual([{ count: 2, status: "acknowledged" }]);
    db.exec("UPDATE alerts SET status='closed'");
    push("Failed password for root from 203.0.113.1 port 22", 202);
    expect(
      db.query("SELECT * FROM alerts WHERE rule_id='ssh-brute-force'").all(),
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("sudo PAM messages do not count as separate invocations", async () => {
  const { parseLine } = await import("../src/server/parsers");
  const db = openDatabase(":memory:");
  const engine = new DetectionEngine(db);
  try {
    for (let i = 0; i < 2; i++)
      engine.evaluate(
        insertEvents(db, [
          parseLine(
            "pam_unix(sudo-i:auth): authentication failure; user=alice",
            { ts: 100 + i * 10 },
          ),
          parseLine(
            "alice : 3 incorrect password attempts ; TTY=pts/0 ; COMMAND=/bin/bash",
            { ts: 101 + i * 10 },
          ),
        ]),
      );
    expect(db.query("SELECT * FROM alerts").all()).toHaveLength(0);
    engine.evaluate(
      insertEvents(db, [
        parseLine(
          "alice : 3 incorrect password attempts ; TTY=pts/0 ; COMMAND=/bin/bash",
          { ts: 200 },
        ),
      ]),
    );
    expect(db.query("SELECT rule_id,count FROM alerts").all()).toEqual([
      { rule_id: "sudo-failures", count: 1 },
    ]);
  } finally {
    db.close();
  }
});

test("cached regex resets stateful flags and enable flags reload on construction", () => {
  const condition = {
    field: "source",
    op: "regex" as const,
    value: "sshd",
    flags: "g",
  };
  const e = { ...event(1), id: 1, ingested_at: 1 };
  expect(matches(e, condition)).toBe(true);
  expect(matches(e, condition)).toBe(true);
  const db = openDatabase(":memory:");
  try {
    const engine = new DetectionEngine(db);
    engine.setEnabled("ssh-brute-force", false);
    expect(new DetectionEngine(db).enabled("ssh-brute-force")).toBe(false);
    engine.setEnabled("ssh-brute-force", true);
    expect(engine.enabled("ssh-brute-force")).toBe(true);
  } finally {
    db.close();
  }
});

test("sorted windows and cached distinct frequencies match a reference with late events", async () => {
  const { random } = await import("../scripts/simulate");
  for (const distinct of [undefined, "user"]) {
    const rng = random(99);
    const db = openDatabase(":memory:");
    const rule: Rule = {
      id: "window",
      name: "Window",
      description: "test",
      mitre: "T1",
      severity: 1,
      kind: "threshold",
      groupBy: ["src_ip"],
      condition: { field: "source", op: "equals", value: "sshd" },
      windowMs: 100,
      threshold: 3,
      distinct,
    };
    const engine = new DetectionEngine(db, [rule]);
    let watermark = 0,
      expected = 0;
    let reference: { ts: number; user: string | null }[] = [];
    try {
      for (let i = 0; i < 300; i++) {
        const ts = 1000 + i * 10 - Math.floor(rng() * 180);
        const user = rng() < 0.2 ? null : `u${Math.floor(rng() * 4)}`;
        watermark = Math.max(watermark, ts);
        reference = reference.filter((e) => e.ts >= watermark - 100);
        if (ts >= watermark - 100) {
          reference.push({ ts, user });
          const relevant = reference.filter((e) => e.ts <= ts);
          const count = distinct
            ? new Set(relevant.map((e) => e.user).filter((v) => v !== null))
                .size
            : relevant.length;
          if (count >= 3) expected++;
        }
        engine.evaluate(
          insertEvents(db, [
            normalize({ ts, user, source: "sshd", src_ip: "203.0.113.1" }),
          ]),
        );
      }
      expect(
        db.query("SELECT coalesce(sum(count),0) AS n FROM alerts").get(),
      ).toEqual({ n: expected });
    } finally {
      db.close();
    }
  }
});
