import { useEffect, useRef, useState } from "react";
import {
  api,
  query,
  type AlertPage,
  type AlertRow,
  type AlertDetail,
  type Status,
} from "../api";
import { usePagedList } from "../hooks/usePagedList";
import { useApi } from "../hooks/useApi";
import { useLive } from "../hooks/live";
import { Link, useRouter } from "../hooks/router";
import { relativeTime, mitreUrl } from "../logic";
import { MinimumSeverity, Region, Severity } from "../components/common";
import { EventsTable } from "../components/EventsTable";
const selectAlerts = (page: AlertPage) => page.alerts;
export function AlertList({ rows }: { rows: AlertRow[] }) {
  return rows.length ? (
    <div className="alert-list">
      {rows.map((a) => (
        <Link className="alert-row" key={a.id} href={`/alerts/${a.id}`}>
          <Severity value={a.severity} />
          <div className="alert-copy">
            <strong>{a.title}</strong>
            <span className="muted">
              {a.rule_name} · {a.mitre}
            </span>
          </div>
          <span className="alert-hits">
            {a.count.toLocaleString()} {a.count === 1 ? "hit" : "hits"}
          </span>
          <div className="alert-times">
            <time title={new Date(a.first_seen).toLocaleString()}>
              First {relativeTime(a.first_seen)}
            </time>
            <time title={new Date(a.last_seen).toLocaleString()}>
              Last {relativeTime(a.last_seen)}
            </time>
          </div>
          <span className="status-pill">{a.status}</span>
          <span className="alert-chevron" aria-hidden="true" />
        </Link>
      ))}
    </div>
  ) : (
    <p className="state">No alerts match this view.</p>
  );
}
export function Alerts() {
  const { url, navigate } = useRouter();
  const { alerts: live } = useLive();
  const status = url.searchParams.get("status") ?? "open";
  const severity = url.searchParams.get("severity_min") ?? "";
  const path =
    "/alerts" +
    query({ status: status === "all" ? null : status, severity_min: severity });
  const result = usePagedList(path, selectAlerts);
  function filter(key: string, value: string) {
    const p = new URLSearchParams(url.search);
    if (value) p.set(key, value);
    else p.delete(key);
    navigate("/alerts" + (p.size ? "?" + p : ""));
  }
  const map = new Map(
    result.rows.map((a) => [a.id, a]),
  );
  for (const a of live) {
    const existing = map.get(a.id);
    if (!existing || a.updated_at >= existing.updated_at) map.set(a.id, a);
  }
  const rows = [...map.values()]
    .filter(
      (a) =>
        (status === "all" || a.status === status) &&
        a.severity >= Number(severity || 0),
    )
    .sort((a, b) => b.last_seen - a.last_seen || b.id - a.id);
  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h1>Alerts</h1>
          <p className="subtitle">
            Investigate detections and manage their status.
          </p>
        </div>
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Alert status">
            {["open", "acknowledged", "closed", "all"].map((s) => (
              <button
                key={s}
                aria-pressed={status === s}
                onClick={() => filter("status", s)}
              >
                {s[0]!.toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <MinimumSeverity
            value={severity}
            onChange={(v) => filter("severity_min", v)}
          />
        </div>
      </div>
      <section className="panel">
        <Region {...result}>
          <AlertList rows={rows} />
        </Region>
        {result.moreError && (
          <p role="alert" className="error">
            {result.moreError}{" "}
            <button onClick={result.retryMore}>
              Retry
            </button>
          </p>
        )}
        {result.hasMore && (
          <button
            className="load-more"
            disabled={result.loadingMore}
            onClick={result.loadMore}
          >
            {result.loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </section>
    </>
  );
}
export function AlertView({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);
  const result = useApi<AlertDetail>(busy ? null : `/alerts/${id}`);
  const dirty = useRef(false);
  const { alerts: live } = useLive();
  const [data, setData] = useState<AlertDetail>();
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<Status>();
  useEffect(() => {
    setData(result.data);
    setError("");
  }, [result.data]);
  useEffect(() => {
    const a = live.find((a) => a.id === id);
    if (a) dirty.current = true;
    if (a && !busy)
      setData((d) => (d && a.updated_at >= d.updated_at ? { ...d, ...a } : d));
  }, [live, id, busy]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!busy && dirty.current) {
        dirty.current = false;
        result.retry();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [id, busy, result.retry]);
  async function change(status: Status) {
    if (!data) return;
    const previous = data;
    setBusy(true);
    setError("");
    setFailed(status);
    setData({ ...data, status });
    try {
      setData(await api<AlertDetail>(`/alerts/${id}`, undefined, { status }));
    } catch (e) {
      setData(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link href="/alerts" className="back-link">
        ← Alerts
      </Link>
      <Region {...result}>
        {data && (
          <>
            <section className="panel detail-header">
              <div className="detail-top">
                <div className="page-title">
                  <div className="pill-row">
                    <Severity value={data.severity} />
                    <span className="status-pill">{data.status}</span>
                  </div>
                  <h1>{data.title}</h1>
                  <p className="subtitle">
                    {data.rule_name} ·{" "}
                    <a href={mitreUrl(data.mitre)} target="_blank" rel="noreferrer">
                      {data.mitre} ↗
                    </a>
                  </p>
                </div>
                <div className="actions">
                  {data.status !== "acknowledged" && (
                    <button
                      disabled={busy}
                      onClick={() => change("acknowledged")}
                    >
                      Acknowledge
                    </button>
                  )}
                  {data.status !== "closed" && (
                    <button disabled={busy} onClick={() => change("closed")}>
                      Close
                    </button>
                  )}
                  {data.status !== "open" && (
                    <button disabled={busy} onClick={() => change("open")}>
                      Reopen
                    </button>
                  )}
                </div>
              </div>
              <dl className="detail-meta">
                <div>
                  <dt>First seen</dt>
                  <dd>{new Date(data.first_seen).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{new Date(data.last_seen).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Count</dt>
                  <dd>{data.count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Rule ID</dt>
                  <dd>{data.rule_id}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(data.created_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{new Date(data.updated_at).toLocaleString()}</dd>
                </div>
              </dl>
              {error && (
                <p role="alert" className="error">
                  {error}{" "}
                  <button onClick={() => failed && change(failed)}>
                    Retry
                  </button>
                </p>
              )}
            </section>
            <section className="panel">
              <h2>Evidence events</h2>
              <EventsTable events={data.events} />
            </section>
          </>
        )}
      </Region>
    </>
  );
}
