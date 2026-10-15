import type { Bucket } from "./api";

export const ranges = ["15m", "1h", "6h", "24h", "7d"] as const;
export type Range = (typeof ranges)[number];
export function timeRange(range: string, now = Date.now()) {
  const duration =
    (
      {
        "15m": 900000,
        "1h": 3600000,
        "6h": 21600000,
        "24h": 86400000,
        "7d": 604800000,
      } as Record<string, number>
    )[range] ?? 86400000;
  return { from: Math.max(0, now - duration), to: now };
}
export function niceTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1, 2, 3, 4];
  const power = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 5, 10].map((n) => n * power).find((n) => n >= max / 4)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}
export function axisTime(t: number, span: number) {
  return new Intl.DateTimeFormat(
    undefined,
    span > 2 * 86400000
      ? { month: "short", day: "numeric" }
      : { hour: "2-digit", minute: "2-digit", hour12: false },
  ).format(t);
}
export function relativeTime(t: number, now = Date.now()) {
  const seconds = Math.round((t - now) / 1000);
  const [unit, size] =
    Math.abs(seconds) < 60
      ? (["second", 1] as const)
      : Math.abs(seconds) < 3600
        ? (["minute", 60] as const)
        : Math.abs(seconds) < 86400
          ? (["hour", 3600] as const)
          : (["day", 86400] as const);
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(seconds / size),
    unit,
  );
}
export function mitreUrl(id: string) {
  return `https://attack.mitre.org/techniques/${id.replaceAll(".", "/")}/`;
}
export function matchPath(path: string) {
  const detail = /^\/alerts\/(\d+)$/.exec(path);
  if (detail) return { page: "detail", id: Number(detail[1]) };
  return {
    page:
      (
        {
          "/": "overview",
          "/events": "events",
          "/alerts": "alerts",
          "/rules": "rules",
        } as Record<string, string>
      )[path] ?? "missing",
    id: undefined,
  };
}

export function mergeRows<T extends { id: number }>(first: T[], next: T[]): T[] {
  return [...new Map([...first, ...next].map((row) => [row.id, row])).values()];
}
export function compactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value);
}
export function bucketCaption(ms: number) {
  if (ms % 86400000 === 0) return `${ms / 86400000} day`;
  if (ms % 3600000 === 0) return `${ms / 3600000} h`;
  return `${ms / 60000} min`;
}
export function bucketTime(t: number, span: number) {
  return new Intl.DateTimeFormat(undefined, {
    ...(span > 86400000 ? { month: "short", day: "numeric" } as const : {}),
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(t);
}

export type Slice = { key: string; label: string; value: number };
export function percentOf(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}
// Keeps at most `keep` named slices (largest first, input order preserved) and
// folds the rest into one "Other" slice. Zero-valued slices are dropped.
export function foldSlices(items: Slice[], keep = 5): Slice[] {
  const merged = new Map<string, Slice>();
  for (const s of items) {
    if (!Number.isFinite(s.value) || s.value <= 0) continue;
    const previous = merged.get(s.key);
    merged.set(s.key, { ...s, value: Math.min(Number.MAX_VALUE, (previous?.value ?? 0) + s.value) });
  }
  const live = [...merged.values()];
  if (live.length <= keep) return live;
  const top = new Set(
    [...live].sort((a, b) => b.value - a.value).slice(0, keep),
  );
  const kept = live.filter((s) => top.has(s) && s.key !== "other");
  const rest = live.reduce((n, s) => (top.has(s) && s.key !== "other" ? n : Math.min(Number.MAX_VALUE, n + s.value)), 0);
  return [...kept, { key: "other", label: "Other", value: rest }];
}

export function polar(cx: number, cy: number, r: number, angle: number) {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
}
// Ring segments clockwise from `start` (12 o'clock by default). A constant
// `gap` in pixels separates adjacent segments on both radii. Zero values keep
// their index with an empty path so callers can line up colours and labels.
export function donutArcs(
  values: number[],
  { cx, cy, outer, inner, gap = 2, start = -Math.PI / 2 }: {
    cx: number; cy: number; outer: number; inner: number; gap?: number; start?: number;
  },
) {
  values = values.map((v) => Number.isFinite(v) && v > 0 ? v : 0);
  const scale = Math.max(1, ...values);
  values = values.map((v) => v / scale);
  const live = values.filter((v) => v > 0);
  const total = live.reduce((n, v) => n + v, 0);
  let angle = start;
  return values.map((v) => {
    if (!(v > 0) || total <= 0) return { start: angle, end: angle, path: "" };
    const a = angle;
    const b = a + (v / total) * Math.PI * 2;
    angle = b;
    if (live.length === 1) {
      // A full ring cannot be one arc, so it is drawn as two half arcs.
      return {
        start: a,
        end: b,
        path: `M${cx + outer},${cy} A${outer},${outer} 0 1 1 ${cx - outer},${cy} A${outer},${outer} 0 1 1 ${cx + outer},${cy} Z M${cx + inner},${cy} A${inner},${inner} 0 1 0 ${cx - inner},${cy} A${inner},${inner} 0 1 0 ${cx + inner},${cy} Z`,
      };
    }
    const padO = Math.min(Math.max(0, gap / 2 / outer), (b - a) / 4);
    const padI = Math.min(Math.max(0, gap / 2 / inner), (b - a) / 4);
    const s = a + padO, e = b - padO;
    const si = a + padI, ei = b - padI;
    const large = e - s > Math.PI ? 1 : 0;
    const largeI = ei - si > Math.PI ? 1 : 0;
    const p0 = polar(cx, cy, outer, s), p1 = polar(cx, cy, outer, e);
    const p2 = polar(cx, cy, inner, ei), p3 = polar(cx, cy, inner, si);
    const f = (p: readonly [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    return {
      start: a,
      end: b,
      path: `M${f(p0)} A${outer},${outer} 0 ${large} 1 ${f(p1)} L${f(p2)} A${inner},${inner} 0 ${largeI} 0 ${f(p3)} Z`,
    };
  });
}

export function extent(values: number[]) {
  if (!values.length) return { min: 0, max: 0 };
  return { min: Math.min(...values), max: Math.max(...values) };
}
export function sparkPoints(values: number[], w: number, h: number, pad = 2) {
  values = values.filter(Number.isFinite);
  const scale = Math.max(1, ...values.map(Math.abs));
  values = values.map((v) => v / scale);
  const { min, max } = extent(values);
  const span = max - min;
  const n = values.length;
  return values.map((v, i) => ({
    x: n > 1 ? pad + (i * (w - 2 * pad)) / (n - 1) : w / 2,
    y: span > 0 ? pad + (h - 2 * pad) * (1 - (v - min) / span) : h / 2,
  }));
}
export function sparkPath(values: number[], w: number, h: number, pad = 2) {
  return sparkPoints(values, w, h, pad)
    .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join("");
}
// Failure share per bucket, in percent. Empty buckets read as 0 instead of NaN.
export function failureRates(buckets: Bucket[]) {
  return buckets.map((b) => percentOf(b.failure, b.total));
}

export type Point = { x: number; y: number };
// Area and line paths for a chart with a flat baseline (larger y is lower).
// "monotone" uses Fritsch-Carlson slopes, so the curve never overshoots the
// data; "linear" joins points with straight segments.
export function areaPaths(points: Point[], baseline: number, curve: "monotone" | "linear" = "monotone") {
  // Bound coordinates before slope arithmetic to avoid overflow for finite extremes.
  const coordinate = (v: number) => Math.max(-1e100, Math.min(1e100, v));
  points = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: coordinate(p.x), y: coordinate(p.y) }));
  baseline = Number.isFinite(baseline) ? coordinate(baseline) : 0;
  if (!points.length) return { line: "", area: "" };
  const f = (n: number) => n.toFixed(2);
  const at = (i: number): Point => points[i]!;
  const first = at(0), last = at(points.length - 1);
  let line = `M${f(first.x)},${f(first.y)}`;
  if (curve === "linear" || points.length < 3) {
    for (const p of points.slice(1)) line += `L${f(p.x)},${f(p.y)}`;
  } else {
    const n = points.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = at(i + 1).x - at(i).x;
      d.push(dx === 0 ? 0 : (at(i + 1).y - at(i).y) / dx);
    }
    const m: number[] = new Array(n).fill(0);
    m[0] = d[0]!;
    m[n - 1] = d[n - 2]!;
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! > 0 ? (d[i - 1]! + d[i]!) / 2 : 0;
    for (let i = 0; i < n - 1; i++) {
      const di = d[i]!;
      if (di === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i]! / di, b = m[i + 1]! / di;
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * di;
        m[i + 1] = t * b * di;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const p = at(i), q = at(i + 1);
      const h = (q.x - p.x) / 3;
      line += `C${f(p.x + h)},${f(p.y + m[i]! * h)} ${f(q.x - h)},${f(q.y - m[i + 1]! * h)} ${f(q.x)},${f(q.y)}`;
    }
  }
  const area = `${line}L${f(last.x)},${f(baseline)}L${f(first.x)},${f(baseline)}Z`;
  return { line, area };
}

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Rows are local weekdays (Mon first), columns are local hours. Each bucket is
// placed by its start time, so a 7-day window fills each weekday once.
export function heatmapGrid(buckets: Bucket[]) {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const b of buckets) {
    const date = new Date(b.t);
    grid[(date.getDay() + 6) % 7]![date.getHours()]! += b.total;
  }
  return grid;
}
export function heatLevel(value: number, max: number, levels = 6) {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(levels, Math.max(1, Math.ceil((value / max) * levels)));
}
export function heatLabel(day: number, hour: number, count: number) {
  return `${weekdays[day]} ${String(hour).padStart(2, "0")}:00 — ${count.toLocaleString()} events`;
}
