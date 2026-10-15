import { useAnchoredTooltip } from "../hooks/useAnchoredTooltip";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Bucket } from "../api";
import { heatLabel, heatLevel, heatmapGrid, weekdays } from "../logic";
import { PanelTitle } from "../components/icons";

const left = 44;
const top = 22;
const rowStep = 22;
const cellHeight = 18;
const hours = 24;
const days = 7;
const height = top + days * rowStep;
const hourLabels = [0, 6, 12, 18];
const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -hours, ArrowDown: hours };

// Weekday rows (Mon first) by hour columns. Cells are sized from the container width.
export function Heatmap({ buckets }: { buckets: Bucket[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [table, setTable] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0]?.contentRect.width ?? 640),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const grid = heatmapGrid(buckets);
  const cells = grid.flat();
  const max = Math.max(0, ...cells);
  const total = cells.reduce((sum, v) => sum + v, 0);
  const step = Math.max(1, width - left - 2) / hours;
  const active = hover ?? focused;
  const at = (i: number) => ({ day: Math.floor(i / hours), hour: i % hours });
  const selected = active === null ? null : at(active);
  const count = selected ? grid[selected.day]![selected.hour]! : 0;
  const busiest = at(cells.indexOf(max));
  const summary = total
    ? `Activity by hour, last 7 days: ${total.toLocaleString()} events. Busiest: ${heatLabel(busiest.day, busiest.hour, max)}.`
    : "Activity by hour, last 7 days: no events.";
  const tip = useAnchoredTooltip(ref, !!selected && !table,
    left + (selected?.hour ?? 0) * step + step / 2 + 10,
    top + (selected?.day ?? 0) * rowStep - 30);

  function onKeyDown(e: KeyboardEvent) {
    const last = days * hours - 1;
    if (!["Home", "End", "Escape", ...Object.keys(moves)].includes(e.key)) return;
    e.preventDefault();
    setHover(null);
    if (e.key === "Escape") setFocused(null);
    else if (e.key === "Home") setFocused(0);
    else if (e.key === "End") setFocused(last);
    else {
      const move = moves[e.key]!;
      setFocused((i) =>
        Math.max(0, Math.min(last, i === null ? (move > 0 ? 0 : last) : i + move)),
      );
    }
  }

  return (
    <section className="panel panel-accent">
      <div className="section-heading">
        <PanelTitle icon="grid">Activity by hour (last 7 days)</PanelTitle>
        <button aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      <div className="legend heat-legend">
        <span className="muted">Less</span>
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <i key={level} className={`heat-swatch heat-${level}`} aria-hidden="true" />
        ))}
        <span className="muted">More</span>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {selected ? heatLabel(selected.day, selected.hour, count) : ""}
      </span>
      <div ref={ref} className="chart-container heat-chart">
        {table ? (
          <div className="table-scroll heat-data">
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  {Array.from({ length: hours }, (_, h) => (
                    <th scope="col" key={h}>
                      {String(h).padStart(2, "0")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekdays.map((day, d) => (
                  <tr key={day}>
                    <th scope="row">{day}</th>
                    {grid[d]!.map((v, h) => (
                      <td key={h} className="numeric">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <svg
              width="100%"
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              tabIndex={0}
              aria-label={summary}
              onFocus={() => setFocused(0)}
              onBlur={() => setFocused(null)}
              onKeyDown={onKeyDown}
              onMouseLeave={() => setHover(null)}
            >
              {hourLabels.map((h) => (
                <text
                  key={h}
                  className="axis"
                  x={left + h * step + step / 2}
                  y={top - 8}
                  textAnchor="middle"
                >
                  {`${String(h).padStart(2, "0")}:00`}
                </text>
              ))}
              {weekdays.map((day, d) => (
                <text
                  key={day}
                  className="axis"
                  x={left - 8}
                  y={top + d * rowStep + cellHeight / 2 + 4}
                  textAnchor="end"
                >
                  {day}
                </text>
              ))}
              {cells.map((v, i) => {
                const { day, hour } = at(i);
                return (
                  <rect
                    key={i}
                    className={`heat-${heatLevel(v, max)}${active === i ? " heat-focus" : ""}`}
                    x={left + hour * step + 1}
                    y={top + day * rowStep}
                    width={Math.max(0, step - 2)}
                    height={cellHeight}
                    rx={3}
                  />
                );
              })}
              {cells.map((_, i) => {
                const { day, hour } = at(i);
                return (
                  <rect
                    key={`hit${i}`}
                    className="heat-hit"
                    x={left + hour * step}
                    y={top + day * rowStep - (rowStep - cellHeight) / 2}
                    width={step}
                    height={rowStep}
                    onMouseEnter={() => setHover(i)}
                  />
                );
              })}
            </svg>
            {selected && tip && (
              <div className="chart-tooltip" style={tip}>
                {heatLabel(selected.day, selected.hour, count)}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
