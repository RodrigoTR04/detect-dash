import { describe, test, expect } from "bun:test";
import { parseSshd } from "../src/server/parsers/sshd";
import { parseSudo, parseUserManagement } from "../src/server/parsers/sudo";
import { parseAccessLog } from "../src/server/parsers/access-log";
import { parseSyslog } from "../src/server/parsers/syslog";
import { normalize } from "../src/server/parsers/json";
import { parseLine } from "../src/server/parsers";
describe("parsers", () => {
  test("SSH variants, IPv6 and negative", () => {
    const e = parseSshd(
      "Failed password for invalid user nobody from 2001:db8::1 port 22 ssh2",
      {},
    )!;
    expect(e).toMatchObject({
      user: "nobody",
      src_ip: "2001:db8::1",
      outcome: "failure",
      severity: 1,
      fields: { invalid_user: true, port: 22 },
    });
    expect(parseSshd("Invalid user root from 203.0.113.1", {})?.severity).toBe(
      2,
    );
    for (const method of ["password", "publickey"])
      expect(
        parseSshd(`Accepted ${method} for alice from 10.0.0.1 port 22`, {})
          ?.outcome,
      ).toBe("success");
    expect(
      parseSshd(
        "Connection closed by authenticating user alice 2001:db8::2 port 22 [preauth]",
        {},
      )?.src_ip,
    ).toBe("2001:db8::2");
    expect(
      parseSshd("Disconnected from user alice 10.0.0.1 port 22", {})?.user,
    ).toBe("alice");
    expect(parseSshd("unrelated", {})).toBeNull();
  });
  test("sudo and user management", () => {
    expect(parseSudo("alice : 3 incorrect password attempts", {})?.user).toBe(
      "alice",
    );
    expect(
      parseSudo(
        "alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/bin/id",
        {},
      ),
    ).toMatchObject({
      user: "alice",
      outcome: "success",
      fields: { target_user: "root", command: "/bin/id" },
    });
    expect(
      parseSudo("pam_unix(sudo:auth): authentication failure; user=alice", {
        source: "sudo",
      }),
    ).toMatchObject({ user: "alice", severity: 1 });
    expect(
      parseSudo("alice : 3 incorrect password attempts", { source: "sudo" })
        ?.outcome,
    ).toBe("failure");
    expect(parseSudo("hello", {})).toBeNull();
    expect(
      parseUserManagement("new user: name=bob, UID=1001", {})?.action,
    ).toBe("user_add");
    expect(parseUserManagement("add 'bob' to group 'sudo'", {})).toMatchObject({
      user: "bob",
      severity: 3,
      fields: { group: "sudo" },
    });
    expect(
      parseUserManagement("new group: name=staff, GID=1001", {})?.severity,
    ).toBe(2);
    expect(parseUserManagement("hello", {})).toBeNull();
  });
  test("combined access log", () => {
    const e = parseAccessLog(
      '2001:db8::1 - bob [15/Oct/2026:12:30:00 +0000] "GET /a HTTP/1.1" 503 123 "-" "Agent"',
      {},
    )!;
    expect(e).toMatchObject({
      src_ip: "2001:db8::1",
      user: "bob",
      severity: 1,
      outcome: "failure",
      ts: Date.parse("2026-10-15T12:30:00Z"),
      fields: {
        method: "GET",
        path: "/a",
        status: 503,
        bytes: 123,
        user_agent: "Agent",
      },
    });
    expect(parseAccessLog("not access", {})).toBeNull();
  });
  test("3164 header and year rollover", () => {
    const now = new Date(2026, 0, 1, 0, 0).getTime();
    const h = parseSyslog(
      "<34>Dec 31 23:59:00 host sshd[42]: Invalid user bob from 10.0.0.1",
      { now },
    )!;
    expect(new Date(h.context.ts!).getFullYear()).toBe(2025);
    expect(h.context).toMatchObject({
      host: "host",
      source: "sshd",
      severity: 4,
      fields: { pid: 42 },
    });
    expect(
      parseLine(
        "<34>Dec 31 23:59:00 host sshd[42]: Invalid user bob from 10.0.0.1",
        { now },
      ).category,
    ).toBe("auth");
    expect(parseSyslog("bad header")).toBeNull();
    expect(parseSyslog("<999>bad")).toBeNull();
  });
  test("5424 headers with structured data and nil fields", () => {
    const h = parseSyslog(
      '<165>1 2026-10-15T12:00:00Z server app 123 ID47 [example@1 key="value"] hello',
    )!;
    expect(h).toMatchObject({
      message: "hello",
      context: {
        host: "server",
        source: "app",
        severity: 1,
        fields: { pid: "123" },
      },
    });
    expect(
      parseSyslog("<14>1 - - - - - - hello", { now: 123 })?.context.ts,
    ).toBe(123);
  });
  test("JSON coercion and raw fallback", () => {
    expect(
      normalize({ ts: "100", severity: "2", message: "ok" }, 1),
    ).toMatchObject({
      ts: 100,
      severity: 2,
      host: "unknown",
      category: "other",
    });
    for (const value of [
      null,
      [],
      { severity: 5 },
      { category: "bad" },
      { fields: [] },
      { ts: "bad" },
      { host: 5 },
    ])
      expect(() => normalize(value)).toThrow();
    expect(parseLine("a strange line")).toMatchObject({
      category: "other",
      message: "a strange line",
      raw: "a strange line",
    });
  });
});

test("logout and bare PAM messages keep their program semantics", () => {
  expect(
    parseLine("Disconnected from user alice 10.0.0.5 port 50000"),
  ).toMatchObject({
    source: "sshd",
    action: "disconnect",
    outcome: "unknown",
    severity: 0,
    user: "alice",
    src_ip: "10.0.0.5",
  });
  expect(
    parseLine(
      "pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=192.0.2.1  user=root",
    ),
  ).toMatchObject({
    source: "sshd",
    action: "pam_auth_failure",
    src_ip: "192.0.2.1",
    user: "root",
  });
});

test("all SSH authentication methods and disconnect forms", () => {
  for (const method of ["password", "publickey", "keyboard-interactive/pam"]) {
    expect(
      parseLine(
        `Failed ${method} for invalid user alice from 192.0.2.1 port 22`,
      ),
    ).toMatchObject({
      action: "login",
      outcome: "failure",
      severity: 1,
      fields: { method, invalid_user: true },
    });
    expect(
      parseLine(`Accepted ${method} for alice from 192.0.2.1`),
    ).toMatchObject({
      action: "login",
      outcome: "success",
      severity: 0,
      fields: { method, invalid_user: false },
    });
  }
  expect(parseLine("Invalid user alice from 192.0.2.1 port 22")).toMatchObject({
    action: "invalid_user",
    outcome: "failure",
    severity: 2,
  });
  for (const raw of [
    "Connection closed by authenticating user alice 192.0.2.1 port 22",
    "Connection closed by 192.0.2.1",
    "Disconnected from user alice 192.0.2.1",
    "Received disconnect from 192.0.2.1 port 22:11: Bye Bye",
  ])
    expect(parseLine(raw)).toMatchObject({
      action: "disconnect",
      outcome: "unknown",
      severity: 0,
      src_ip: "192.0.2.1",
    });
  expect(
    parseSudo(
      "pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=192.0.2.1  user=root",
      {},
    ),
  ).toBeNull();
  expect(
    parseLine(
      "alice : 3 incorrect password attempts ; TTY=pts/0 ; COMMAND=/bin/bash",
    ),
  ).toMatchObject({
    source: "sudo",
    action: "sudo",
    outcome: "failure",
    severity: 2,
    fields: { attempts: 3 },
  });
});
