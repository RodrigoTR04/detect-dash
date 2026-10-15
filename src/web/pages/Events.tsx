import { useEffect, useMemo, useState } from "react";
import { query, type EventPage } from "../api";
import { usePagedList } from "../hooks/usePagedList";
import { useRouter } from "../hooks/router";
import { timeRange } from "../logic";
import { EventsTable } from "../components/EventsTable";
import { MinimumSeverity, RangeControl, Region } from "../components/common";
const selectEvents = (page: EventPage) => page.events;
const keys = [
  "q",
  "category",
  "source",
  "outcome",
  "severity_min",
  "src_ip",
  "user",
  "host",
] as const;
export function Events() {
  const { url, navigate } = useRouter();
  const search = url.search;
  const filters = Object.fromEntries(
    keys.map((k) => [k, url.searchParams.get(k) ?? ""]),
  );
  const bounds = useMemo(
    () => ({
      ...timeRange(new URLSearchParams(search).get("range") ?? "24h"),
      ...Object.fromEntries(
        ["from", "to"].flatMap((k) => {
          const v = new URLSearchParams(search).get(k);
          return v ? [[k, Number(v)]] : [];
        }),
      ),
    }),
    [search],
  );
  const path = "/events" + query({ ...filters, ...bounds });
  const result = usePagedList(path, selectEvents);
  const [draft, setDraft] = useState(filters.q ?? "");
  useEffect(() => {
    setDraft(filters.q ?? "");
  }, [filters.q]);
  useEffect(() => {
    if (draft === filters.q) return;
    const timer = setTimeout(() => setFilter("q", draft, true), 300);
    return () => clearTimeout(timer);
  }, [draft, search]);
  function setFilter(key: string, value: string, replace = false) {
    const p = new URLSearchParams(search);
    if (value.trim()) p.set(key, value);
    else p.delete(key);
    navigate("/events" + (p.size ? "?" + p : ""), replace);
  }
  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h1>Events</h1>
          <p className="subtitle">Search and inspect normalized security events.</p>
        </div>
      </div>
      <div className="panel filters">
        <label className="search-field">
          Search message
          <input
            value={draft}
            placeholder="Search events…"
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        {["category", "outcome"].map((k) => (
          <label key={k}>
            {k}
            <select
              value={filters[k]}
              onChange={(e) => setFilter(k, e.target.value)}
            >
              <option value="">All</option>
              {(k === "category"
                ? ["auth", "network", "process", "web", "system", "other"]
                : ["success", "failure", "unknown"]
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        {["source", "src_ip", "user", "host"].map((k) => (
          <label key={k}>
            {k}
            <input
              value={filters[k]}
              onChange={(e) => setFilter(k, e.target.value)}
              placeholder="Any"
            />
          </label>
        ))}
        <MinimumSeverity
          value={filters.severity_min ?? ""}
          onChange={(v) => setFilter("severity_min", v)}
        />
        <RangeControl />
      </div>
      <div className="chips">
        {keys
          .filter((k) => filters[k])
          .map((k) => (
            <button key={k} onClick={() => setFilter(k, "")}>
              {k}: {filters[k]} <span aria-label="Remove filter">×</span>
            </button>
          ))}
      </div>
      <section className="panel event-log">
        <div className="section-heading">
          <h2>Event log</h2>
          <span className="muted">
            {result.rows.length} loaded
          </span>
        </div>
        <Region {...result}>
          {result.data && (
            <EventsTable events={result.rows} />
          )}
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
