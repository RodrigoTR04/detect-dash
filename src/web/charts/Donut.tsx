import { useAnchoredTooltip } from "../hooks/useAnchoredTooltip";
import { useRef, useState, type KeyboardEvent } from "react";
import { donutArcs, foldSlices, percentOf, type Slice } from "../logic";
import { PanelTitle, type IconName } from "../components/icons";

export type DonutSlice = Slice & { color?: string };

const size = 168;
const cx = size / 2;
const outer = 80;
// The ring is about 22% of the radius thick.
const inner = Math.round(outer * 0.78 * 10) / 10;
const statusColors = [
  "var(--info)",
  "var(--low)",
  "var(--medium)",
  "var(--high)",
  "var(--critical)",
];
const navigationKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"];

// Part-to-whole ring with a legend. Slices keep their order, the hovered or
// focused slice is highlighted and the rest dim. The legend is the table twin.
export function Donut({
  title,
  icon,
  slices,
  fold,
  mode = "categorical",
  caption,
}: {
  title: string;
  icon: IconName;
  slices: DonutSlice[];
  fold?: number;
  mode?: "categorical" | "status";
  caption: string;
}) {
  const items = (fold ? foldSlices(slices, fold) : slices.filter((s) => s.value > 0)) as DonutSlice[];
  const n = items.length;
  const total = items.reduce((sum, s) => sum + s.value, 0);
  const colors = items.map((s, i) => {
    if (s.color) return s.color;
    if (mode === "status") return statusColors[Number(s.key)] ?? "var(--muted)";
    return s.key === "other" || i >= 5 ? "var(--cat-other)" : `var(--cat-${i + 1})`;
  });
  const arcs = donutArcs(items.map((s) => s.value), { cx, cy: cx, outer, inner });
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const figure = useRef<HTMLDivElement>(null);
  const active = hover ?? focused;
  const current = active === null ? undefined : items[active];
  const arc = active === null ? undefined : arcs[active];
  const share = (value: number) => `${percentOf(value, total).toFixed(1)}%`;
  const summary = n
    ? `${title}, ${total.toLocaleString()} total. ${items
        .map((s) => `${s.label} ${s.value.toLocaleString()} (${share(s.value)})`)
        .join("; ")}.`
    : `${title}: no data in this range.`;

  const mid = arc ? (arc.start + arc.end) / 2 : 0;
  const radius = (outer + inner) / 2;
  const tip = useAnchoredTooltip(figure, !!current,
    cx + radius * Math.cos(mid) + 12, cx + radius * Math.sin(mid) - 28);

  function onKeyDown(e: KeyboardEvent) {
    if (!n || !navigationKeys.includes(e.key)) return;
    e.preventDefault();
    setHover(null);
    if (e.key === "Escape") setFocused(null);
    else if (e.key === "Home") setFocused(0);
    else if (e.key === "End") setFocused(n - 1);
    else {
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      setFocused((i) => (i === null ? (forward ? 0 : n - 1) : (i + (forward ? 1 : n - 1)) % n));
    }
  }

  return (
    <section className="panel panel-accent">
      <PanelTitle icon={icon}>{title}</PanelTitle>
      {n === 0 ? (
        <p className="state">No data in this range.</p>
      ) : (
        <div className="donut">
          <div className="donut-figure" ref={figure}>
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              role="img"
              tabIndex={0}
              aria-label={summary}
              onFocus={() => setFocused(0)}
              onBlur={() => setFocused(null)}
              onKeyDown={onKeyDown}
              onMouseLeave={() => setHover(null)}
            >
              {arcs.map((a, i) => (
                <path
                  key={items[i]!.key}
                  d={a.path}
                  fill={colors[i]}
                  style={{ opacity: active === null || active === i ? 1 : 0.4 }}
                  onMouseEnter={() => setHover(i)}
                />
              ))}
            </svg>
            <div className="donut-center" aria-hidden="true">
              <strong>{(current ? current.value : total).toLocaleString()}</strong>
              <span>{current ? current.label : caption}</span>
            </div>
          </div>
          <ul className="donut-legend" onMouseLeave={() => setHover(null)}>
            {items.map((s, i) => (
              <li
                key={s.key}
                className={active === i ? "active" : undefined}
                onMouseEnter={() => setHover(i)}
              >
                <span className="swatch" style={{ background: colors[i] }} aria-hidden="true" />
                <span className="donut-label">{s.label}</span>
                <span className="donut-value numeric">{s.value.toLocaleString()}</span>
                <span className="donut-share numeric">{share(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {current && tip && (
        <div className="chart-tooltip" style={tip}>
          {current.label}
          <br />
          {current.value.toLocaleString()} · {share(current.value)}
        </div>
      )}
    </section>
  );
}
