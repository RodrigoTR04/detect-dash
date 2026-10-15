import { useAnchoredTooltip } from "../hooks/useAnchoredTooltip";
import { useEffect, useRef, useState } from "react";
import type { Bucket } from "../api";
import { areaPaths, axisTime, niceTicks, compactNumber, bucketCaption, bucketTime } from "../logic";
import { PanelTitle } from "../components/icons";

export function Timeline({
  data,
  bucketMs,
}: {
  data: Bucket[];
  bucketMs: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [table, setTable] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0]?.contentRect.width ?? 700),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const ticks = niceTicks(Math.max(0, ...data.map((b) => b.total)));
  const max = ticks.at(-1)!;
  const left = 48,
    top = 16,
    height = 190,
    bottom = top + height,
    plot = Math.max(1, width - left - 16),
    step = plot / Math.max(1, data.length);
  const x = (i: number) => left + (i + 0.5) * step;
  const y = (v: number) => bottom - (v / max) * height;
  const span = (data.at(-1)?.t ?? 0) - (data[0]?.t ?? 0);
  const total = areaPaths(data.map((b, i) => ({ x: x(i), y: y(b.total) })), bottom);
  const failures = areaPaths(data.map((b, i) => ({ x: x(i), y: y(b.failure) })), bottom);
  const highlighted = hover ?? (focused === null ? null : Math.min(focused, data.length - 1));
  const selected = highlighted === null ? undefined : data[highlighted];
  const tip = useAnchoredTooltip(ref, !!selected && !table, x(highlighted ?? 0), 18, 85);
  const every = Math.max(1, Math.ceil(data.length / 6));
  const sum = data.reduce((n, b) => n + b.total, 0);
  const failed = data.reduce((n, b) => n + b.failure, 0);
  return (
    <section className="panel panel-accent timeline">
      <div className="section-heading">
        <PanelTitle icon="chart">Events over time</PanelTitle>
        <button aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      <div className="legend">
        <span>
          <i className="other" />
          All events
        </span>
        <span>
          <i className="failure" />
          Failures
        </span>
        <span className="muted">
          {bucketCaption(bucketMs)} buckets
        </span>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {focused !== null && data[Math.min(focused, data.length - 1)] && (() => {
          const b = data[Math.min(focused, data.length - 1)]!;
          return `${bucketTime(b.t, span)}: ${b.total} total, ${b.failure} failures`;
        })()}
      </span>
      <div ref={ref} className="chart-container">
        {table ? (
          <div className="timeline-data table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Bucket time</th>
                  <th scope="col">Total</th>
                  <th scope="col">Failures</th>
                </tr>
              </thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.t}>
                    <td>{bucketTime(b.t, span)}</td>
                    <td>{b.total}</td>
                    <td>{b.failure}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <svg
              width="100%"
              height="250"
              viewBox={`0 0 ${width} 250`}
              role="img"
              tabIndex={0}
              onFocus={() => setFocused(data.length ? 0 : null)}
              onBlur={() => setFocused(null)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)) return;
                e.preventDefault();
                setHover(null);
                if (!data.length || e.key === "Escape") setFocused(null);
                else if (e.key === "Home") setFocused(0);
                else if (e.key === "End") setFocused(data.length - 1);
                else setFocused((i) => Math.max(0, Math.min(data.length - 1,
                  i === null ? (e.key === "ArrowLeft" ? data.length - 1 : 0) : i + (e.key === "ArrowLeft" ? -1 : 1))));
              }}
              aria-label={`Events over time, ${sum} total events and ${failed} failures. Blue area shows all events; orange line shows failures.`}
              onMouseLeave={() => setHover(null)}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    className="gridline"
                    x1={left}
                    x2={width - 16}
                    y1={y(t)}
                    y2={y(t)}
                  />
                  <text
                    className="axis"
                    x={left - 8}
                    y={y(t) + 4}
                    textAnchor="end"
                  >
                    {compactNumber(t)}
                  </text>
                </g>
              ))}
              <path className="area-total" d={total.area} />
              <path className="area-failure" d={failures.area} />
              <path className="line-total" d={total.line} />
              <path className="line-failure" d={failures.line} />
              {data.map((b, i) =>
                i % every === 0 ? (
                  <text
                    className="axis"
                    key={b.t}
                    x={x(i)}
                    y={bottom + 25}
                    textAnchor={i === 0 ? "start" : i + every >= data.length ? "end" : "middle"}
                  >
                    {axisTime(b.t, span)}
                  </text>
                ) : null,
              )}
              {data.map((b, i) => (
                <rect
                  key={b.t}
                  x={left + i * step}
                  y={top}
                  width={step}
                  height={height}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                >
                  <title>
                    {bucketTime(b.t, span)}: {b.total} total,{" "}
                    {b.failure} failures
                  </title>
                </rect>
              ))}
              {selected && highlighted !== null && (
                <>
                  <line
                    className="crosshair"
                    x1={x(highlighted)}
                    x2={x(highlighted)}
                    y1={top}
                    y2={bottom}
                  />
                  <circle
                    className="chart-dot dot-total"
                    cx={x(highlighted)}
                    cy={y(selected.total)}
                    r={5}
                  />
                  <circle
                    className="chart-dot dot-failure"
                    cx={x(highlighted)}
                    cy={y(selected.failure)}
                    r={5}
                  />
                </>
              )}
            </svg>
            {selected && highlighted !== null && (
              <div
                className="chart-tooltip"
                style={tip}
              >
                {bucketTime(selected.t, span)}
                <br />
                {selected.total.toLocaleString()} total ·{" "}
                {selected.failure.toLocaleString()} failures
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
