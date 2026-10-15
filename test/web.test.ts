import { describe, expect, test } from "bun:test";
import { query } from "../src/web/api";
import {
  mergeRows, compactNumber, bucketCaption, bucketTime,
  timeRange,
  niceTicks,
  axisTime,
  relativeTime,
  mitreUrl,
  matchPath,
} from "../src/web/logic";
describe("dashboard pure logic", () => {
  test("query omits unset and whitespace values, preserves zero and escapes identities", () => {
    const p = new URLSearchParams(
      query({
        q: "",
        category: null,
        user: undefined,
        host: "  ",
        severity_min: 0,
        src_ip: "203.0.113.1",
        source: "a & b",
      }).slice(1),
    );
    expect([...p.keys()]).toEqual(["severity_min", "src_ip", "source"]);
    expect(p.get("source")).toBe("a & b");
    expect(query({ q: "" })).toBe("");
  });
  test("all time ranges have fixed inclusive bounds and unknown ranges default to 24h", () => {
    const now = 1_800_000_000_000;
    for (const [range, duration] of Object.entries({
      "15m": 900000,
      "1h": 3600000,
      "6h": 21600000,
      "24h": 86400000,
      "7d": 604800000,
    }))
      expect(timeRange(range, now)).toEqual({ from: now - duration, to: now });
    expect(timeRange("bad", now)).toEqual(timeRange("24h", now));
    expect(timeRange("7d", 100).from).toBe(0);
  });
  test("nice ticks cover the domain with equal readable intervals", () => {
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(137)).toEqual([0, 50, 100, 150]);
    for (const max of [1, 9, 100, 9999]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });
  test("time labels select time of day or calendar day", () => {
    const t = Date.UTC(2026, 9, 15, 12, 30);
    expect(axisTime(t, 3600000)).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(t),
    );
    expect(axisTime(t, 25 * 3600000)).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(t),
    );
    expect(axisTime(t, 604800000)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(t),
    );
  });
  test("relative time supports past, future and day boundaries", () => {
    const now = 1_800_000_000_000;
    const f = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    expect(relativeTime(now, now)).toBe(f.format(0, "second"));
    expect(relativeTime(now - 120000, now)).toBe(f.format(-2, "minute"));
    expect(relativeTime(now + 7200000, now)).toBe(f.format(2, "hour"));
    expect(relativeTime(now - 86400000, now)).toBe(f.format(-1, "day"));
  });
  test("MITRE sub-techniques become nested paths", () => {
    expect(mitreUrl("T1110.001")).toBe(
      "https://attack.mitre.org/techniques/T1110/001/",
    );
    expect(mitreUrl("T1059")).toBe(
      "https://attack.mitre.org/techniques/T1059/",
    );
  });
  test("router matches only known routes and numeric alert IDs", () => {
    expect(matchPath("/").page).toBe("overview");
    expect(matchPath("/events").page).toBe("events");
    expect(matchPath("/alerts").page).toBe("alerts");
    expect(matchPath("/rules").page).toBe("rules");
    expect(matchPath("/alerts/12")).toEqual({ page: "detail", id: 12 });
    for (const p of ["/alerts/no", "/alerts/1/extra", "/no"])
      expect(matchPath(p).page).toBe("missing");
  });
});

test("paged rows deduplicate IDs while preserving order and replacing updated rows", () => {
  expect(mergeRows([{ id: 1, value: "old" }, { id: 2, value: "two" }],
    [{ id: 1, value: "new" }, { id: 3, value: "three" }])).toEqual([
      { id: 1, value: "new" }, { id: 2, value: "two" }, { id: 3, value: "three" },
    ]);
});
test("timeline formats compact counts and human bucket intervals", () => {
  expect(compactNumber(20000)).toBe(new Intl.NumberFormat(undefined, { notation: "compact" }).format(20000));
  expect([60000, 900000, 3600000, 21600000, 86400000].map(bucketCaption)).toEqual(["1 min", "15 min", "1 h", "6 h", "1 day"]);
});
test("bucket times omit seconds and add dates only beyond one day", () => {
  const t = Date.UTC(2026, 9, 15, 12, 30, 59);
  for (const span of [3600000, 86400000, 86400001, 604800000]) {
    expect(bucketTime(t, span)).toBe(new Intl.DateTimeFormat(undefined, {
      ...(span > 86400000 ? { month: "short", day: "numeric" } as const : {}),
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(t));
  }
});

test("muted text meets AA contrast on every theme background", async () => {
  const css = await Bun.file(new URL('../src/web/styles.css', import.meta.url)).text();
  const luminance = (hex: string) => {
    const c = hex.match(/\w\w/g)!.map((v) => {
      const n = parseInt(v, 16) / 255;
      return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
    });
    return .2126 * c[0]! + .7152 * c[1]! + .0722 * c[2]!;
  };
  const scopes = [...css.matchAll(/--page: (#[\da-f]+);[\s\S]*?--text-muted: (#[\da-f]+);/g)];
  expect(scopes).toHaveLength(3);
  for (const scope of scopes) {
    const foreground = luminance(scope[2]!);
    for (const background of scope[0].matchAll(/--(?:page|surface|surface-2): (#[\da-f]+);/g)) {
      const bg = luminance(background[1]!);
      expect((Math.max(foreground, bg) + .05) / (Math.min(foreground, bg) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
