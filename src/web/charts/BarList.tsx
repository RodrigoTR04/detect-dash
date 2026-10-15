import type { Top } from "../api";
import { Link } from "../hooks/router";
import { PanelTitle, type IconName } from "../components/icons";
export function BarList({
  title,
  icon = "list",
  rows,
  href,
  severity = false,
  mono = false,
}: {
  title: string;
  icon?: IconName;
  rows: Top[];
  href?: (value: string) => string;
  severity?: boolean;
  mono?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel panel-accent">
      <PanelTitle icon={icon}>{title}</PanelTitle>
      <div
        role="group"
        aria-label={`${title}: ${rows.map((r) => `${r.value} ${r.count}`).join(", ") || "no data"}`}
      >
        {rows.length ? (
          rows.map((r, i) => (
            <div
              className="bar-row"
              key={r.value}
              title={`${r.value}: ${r.count.toLocaleString()}`}
            >
              <div className="bar-label">
                <span className="rank">{i + 1}</span>
                <span className="bar-name">
                  {href ? (
                    <Link
                      href={href(r.value)}
                      className={mono ? "mono" : undefined}
                    >
                      {r.value}
                    </Link>
                  ) : (
                    <span className={mono ? "mono" : undefined}>
                      {severity && (
                        <span
                          className={`severity-dot sev-${i}`}
                          aria-hidden="true"
                        >
                          ◆{" "}
                        </span>
                      )}
                      {r.value}
                    </span>
                  )}
                </span>
                <span className="numeric">{r.count.toLocaleString()}</span>
              </div>
              <div className="bar-track">
                <div
                  className={severity ? `bar-fill sev-${i}` : "bar-fill"}
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="state">No data in this range.</p>
        )}
      </div>
    </section>
  );
}
