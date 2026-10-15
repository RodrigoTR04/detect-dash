import { describe, expect, test } from "bun:test";
import {
  areaPaths,
  donutArcs,
  failureRates,
  foldSlices,
  heatLabel,
  heatLevel,
  heatmapGrid,
  percentOf,
  sparkPath,
  sparkPoints,
} from "../src/web/logic";

const pairs = (path: string) =>
  [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("donut slices", () => {
  test("folds slices beyond the limit into Other and drops zeros", () => {
    const items = [
      { key: "a", label: "A", value: 1 },
      { key: "b", label: "B", value: 0 },
      { key: "c", label: "C", value: 9 },
      { key: "d", label: "D", value: 4 },
      { key: "e", label: "E", value: 3 },
      { key: "f", label: "F", value: 2 },
      { key: "g", label: "G", value: 5 },
    ];
    const five = foldSlices(items, 5);
    expect(five.map((s) => s.key)).toEqual(["c", "d", "e", "f", "g", "other"]);
    expect(five.at(-1)!.value).toBe(1);
    const four = foldSlices(items, 4);
    expect(four.map((s) => s.key)).toEqual(["c", "d", "e", "g", "other"]);
    expect(four.at(-1)!.value).toBe(1 + 2);
  });

  test("keeps input order and small lists unchanged", () => {
    const items = [
      { key: "x", label: "X", value: 2 },
      { key: "y", label: "Y", value: 7 },
    ];
    expect(foldSlices(items, 5)).toEqual(items);
  });

  test("percentages guard against an empty total", () => {
    expect(percentOf(1, 0)).toBe(0);
    expect(percentOf(1, 4)).toBe(25);
  });
});

describe("donut geometry", () => {
  const cx = 100, cy = 100, outer = 80, inner = 60;

  test("angles cover the full circle and start at 12 o'clock", () => {
    const arcs = donutArcs([1, 1, 2], { cx, cy, outer, inner, gap: 0 });
    expect(arcs[0]!.start).toBeCloseTo(-Math.PI / 2);
    expect(arcs.at(-1)!.end).toBeCloseTo(-Math.PI / 2 + Math.PI * 2);
    const spans = arcs.map((a) => a.end - a.start);
    expect(spans[2]).toBeCloseTo(Math.PI);
  });

  test("zero values keep their index with an empty path", () => {
    const arcs = donutArcs([0, 3, 0, 1], { cx, cy, outer, inner });
    expect(arcs.map((a) => a.path === "")).toEqual([true, false, true, false]);
  });

  test("adjacent segments are separated by the gap at the outer radius", () => {
    const [a, b] = donutArcs([1, 1], { cx, cy, outer, inner, gap: 2 });
    const seg = /^M([-\d.]+),([-\d.]+) A[^ ]+ 0 \d 1 ([-\d.]+),([-\d.]+) /;
    const outerStartB = seg.exec(b!.path)!;
    const outerEndA = seg.exec(a!.path)!;
    const distance = Math.hypot(
      Number(outerEndA[3]) - Number(outerStartB[1]),
      Number(outerEndA[4]) - Number(outerStartB[2]),
    );
    expect(distance).toBeGreaterThan(1.9);
    expect(distance).toBeLessThan(2.1);
  });

  test("a single slice is drawn as a full ring", () => {
    const [arc] = donutArcs([5], { cx, cy, outer, inner });
    expect(arc!.end - arc!.start).toBeCloseTo(Math.PI * 2);
    expect(arc!.path.match(/A/g)?.length).toBe(4);
  });
});

describe("sparklines and failure rates", () => {
  test("scales values into the box and guards flat series", () => {
    const pts = sparkPoints([0, 5, 10], 120, 32, 2);
    expect(pts[0]!.y).toBeCloseTo(30);
    expect(pts[2]!.y).toBeCloseTo(2);
    expect(pts[1]!.y).toBeCloseTo(16);
    expect(sparkPoints([4, 4], 120, 32).every((p) => p.y === 16)).toBe(true);
    expect(sparkPath([1, 2], 120, 32).startsWith("M")).toBe(true);
  });

  test("failure rate is a percentage per bucket with no NaN for empty buckets", () => {
    expect(failureRates([
      { t: 0, total: 0, failure: 0 },
      { t: 1, total: 4, failure: 1 },
    ])).toEqual([0, 25]);
  });
});

describe("area paths", () => {
  const points = [
    { x: 0, y: 100 }, { x: 10, y: 20 }, { x: 20, y: 100 }, { x: 30, y: 100 }, { x: 40, y: 60 },
  ];

  test("monotone curves never leave the band of their data points", () => {
    const { line, area } = areaPaths(points, 100, "monotone");
    expect(line.startsWith("M0.00,100.00C")).toBe(true);
    for (const [, y] of pairs(line)) expect(y!).toBeGreaterThanOrEqual(20 - 1e-6);
    for (const [, y] of pairs(line)) expect(y!).toBeLessThanOrEqual(100 + 1e-6);
    expect(area.endsWith("L0.00,100.00Z")).toBe(true);
  });

  test("linear curves join points with straight segments", () => {
    expect(areaPaths(points, 100, "linear").line).toBe(
      "M0.00,100.00L10.00,20.00L20.00,100.00L30.00,100.00L40.00,60.00",
    );
  });

  test("empty input yields empty paths", () => {
    expect(areaPaths([], 100)).toEqual({ line: "", area: "" });
  });
});

describe("heatmap bucketing and colour steps", () => {
  test("buckets land on local weekday (Mon first) and hour", () => {
    const tue14 = new Date(2026, 9, 13, 14).getTime();
    const sun0 = new Date(2026, 9, 18, 0).getTime();
    const grid = heatmapGrid([
      { t: tue14, total: 5, failure: 0 },
      { t: tue14, total: 2, failure: 0 },
      { t: sun0, total: 9, failure: 0 },
    ]);
    expect(grid.length).toBe(7);
    expect(grid.every((row) => row.length === 24)).toBe(true);
    expect(grid[1]![14]).toBe(7);
    expect(grid[6]![0]).toBe(9);
    expect(heatLabel(1, 14, 1234)).toBe("Tue 14:00 — 1,234 events");
  });

  test("zero is an empty cell and the maximum takes the darkest step", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(1, 1000)).toBe(1);
    expect(heatLevel(100, 100)).toBe(6);
    expect([10, 30, 50, 70, 90].map((v) => heatLevel(v, 100))).toEqual([1, 2, 3, 5, 6]);
  });
});

describe("chart edge cases", () => {
  test("sub-gap slices keep clockwise endpoints and ordered arcs", () => {
    const arcs = donutArcs([1, 9999], { cx: 0, cy: 0, outer: 80, inner: 60 });
    expect(arcs[0]!.end).toBeLessThanOrEqual(arcs[1]!.start);
    for (const arc of arcs) {
      expect(arc.end).toBeGreaterThan(arc.start);
      const coords = pairs(arc.path);
      const angle = (p: number[]) => {
        let a = Math.atan2(p[1]!, p[0]!);
        while (a < arc.start - 0.0002) a += 2 * Math.PI;
        return a;
      };
      expect(angle(coords[2]!)).toBeGreaterThanOrEqual(angle(coords[0]!));
    }
  });
  test("samples each cubic within its own endpoints", () => {
    const points = [100, 20, 21, 100, 99, 0, 80].map((y, i) => ({ x: i * 10, y }));
    const { line, area } = areaPaths(points, 100);
    expect(area.startsWith(line)).toBe(true);
    const segments = [...line.matchAll(/C([^C]+)/g)];
    expect(segments.length).toBe(points.length - 1);
    segments.forEach((segment, i) => {
      const [c1, c2, end] = pairs(segment[1]!);
      const p = points[i]!, q = points[i + 1]!;
      for (const t of [0, .1, .25, .5, .75, .9, 1]) {
        for (const [axis, index] of [["x", 0], ["y", 1]] as const) {
          const v = (1-t)**3*p[axis] + 3*(1-t)**2*t*c1![index]! +
            3*(1-t)*t*t*c2![index]! + t**3*end![index]!;
          expect(v).toBeGreaterThanOrEqual(Math.min(p[axis], q[axis]) - .01);
          expect(v).toBeLessThanOrEqual(Math.max(p[axis], q[axis]) + .01);
        }
      }
    });
  });
  test("empty and single point paths", () => {
    expect(sparkPath([], 120, 32)).toBe("");
    expect(sparkPath([1], 120, 32)).toBe("M60.00,16.00");
    expect(areaPaths([{ x: 1, y: 2 }], 10)).toEqual({ line: "M1.00,2.00", area: "M1.00,2.00L1.00,10.00L1.00,10.00Z" });
  });
  test("non-finite and huge inputs produce finite geometry", () => {
    for (const values of [[NaN, Infinity, 1, 2], [-1e308, 0, 1e308]]) {
      expect(sparkPath(values, 120, 32)).not.toMatch(/NaN|Infinity/);
      const area = areaPaths(values.map((y, x) => ({ x, y })), Infinity);
      expect(area.line + area.area).not.toMatch(/NaN|Infinity/);
      for (const p of sparkPoints(values, 120, 32)) {
        expect(p.y).toBeGreaterThanOrEqual(2);
        expect(p.y).toBeLessThanOrEqual(30);
      }
    }
    const arcs = donutArcs([NaN, Infinity, 1e308, 1e308], { cx: 100, cy: 100, outer: 80, inner: 60 });
    expect(arcs.map((a) => a.path).join("")).not.toMatch(/NaN|Infinity/);
    expect(arcs.at(-1)!.end).toBeCloseTo(1.5 * Math.PI);
  });
  test("folding merges an existing other key", () => {
    const slices = foldSlices([
      { key: "other", label: "Other", value: 100 },
      { key: "a", label: "A", value: 5 },
      { key: "b", label: "B", value: 2 },
    ], 1);
    expect(new Set(slices.map((s) => s.key)).size).toBe(slices.length);
    expect(slices.reduce((n, s) => n + s.value, 0)).toBe(107);
  });
});
