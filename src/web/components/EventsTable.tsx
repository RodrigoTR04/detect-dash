import { useEffect, useRef, useState } from "react";
import type { EventRow, EventDetail } from "../api";
import { query } from "../api";
import { useApi } from "../hooks/useApi";
import { Link, useRouter } from "../hooks/router";
import { Region, Severity, Time } from "./common";
export function Pivot({
  field,
  value,
}: {
  field: string;
  value: string | null;
}) {
  const { url } = useRouter();
  if (!value) return <span className="muted">—</span>;
  const filters =
    url.pathname === "/events"
      ? Object.fromEntries(url.searchParams)
      : { range: url.searchParams.get("range") ?? "24h" };
  return (
    <Link
      className={field === "src_ip" ? "pivot mono" : "pivot"}
      href={"/events" + query({ ...filters, [field]: value })}
    >
      {value}
    </Link>
  );
}
export function EventsTable({ events }: { events: EventRow[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { url } = useRouter();
  useEffect(() => setSelected(null), [url.href]);
  return (
    <>
      {events.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Time",
                  "Severity",
                  "Source",
                  "Host",
                  "Action",
                  "Outcome",
                  "Source IP",
                  "User",
                  "Message",
                ].map((h) => (
                  <th scope="col" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest("a,button"))
                      setSelected(e.id);
                  }}
                >
                  <td>
                    <button
                      className="text-button"
                      aria-label={`Inspect event ${e.id}`}
                      onClick={() => setSelected(e.id)}
                    >
                      <Time value={e.ts} />
                    </button>
                  </td>
                  <td>
                    <Severity value={e.severity} />
                  </td>
                  <td>{e.source}</td>
                  <td>
                    <Pivot field="host" value={e.host} />
                  </td>
                  <td>{e.action}</td>
                  <td>{e.outcome}</td>
                  <td>
                    <Pivot field="src_ip" value={e.src_ip} />
                  </td>
                  <td>
                    <Pivot field="user" value={e.user} />
                  </td>
                  <td className="message" title={e.message}>
                    {e.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="state">No events in this view.</div>
      )}
      {selected !== null && (
        <EventDrawer id={selected} close={() => setSelected(null)} />
      )}
    </>
  );
}
function EventDrawer({ id, close }: { id: number; close: () => void }) {
  const result = useApi<EventDetail>(`/events/${id}`);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button,a[href],select,input,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="backdrop" onClick={close}>
      <div
        className="drawer"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-heading">
          <h2 id="event-title">Event #{id}</h2>
          <button onClick={close} aria-label="Close event">
            ×
          </button>
        </div>
        <Region {...result}>
          {result.data && (
            <>
              <dl>
                {Object.entries(result.data)
                  .filter(([k]) => !["fields", "raw", "alerts"].includes(k))
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>
                        {["src_ip", "user", "host"].includes(key) ? (
                          <Pivot field={key} value={String(value ?? "")} />
                        ) : key === "severity" && typeof value === "number" ? (
                          <Severity value={value} />
                        ) : typeof value === "number" &&
                          ["ts", "ingested_at"].includes(key) ? (
                          new Date(value).toLocaleString()
                        ) : (
                          String(value ?? "—")
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
              <h3>Fields</h3>
              <pre>{JSON.stringify(result.data.fields, null, 2)}</pre>
              <h3>Raw line</h3>
              <pre>{result.data.raw || "No raw line"}</pre>
              <h3>Associated alerts</h3>
              {result.data.alerts.length ? (
                result.data.alerts.map((a) => (
                  <p key={a.id}>
                    <Link href={`/alerts/${a.id}`}>{a.title}</Link>
                  </p>
                ))
              ) : (
                <p>No associated alerts.</p>
              )}
            </>
          )}
        </Region>
      </div>
    </div>
  );
}
