import { useMemo, useRef, useState, type ReactNode } from "react";
import { query, type Stats, type AlertPage, type AlertRow } from "../api";
import { useAlertSummary } from "../hooks/alertSummary";
import { useApi } from "../hooks/useApi";
import { useLive } from "../hooks/live";
import { Link, useRouter } from "../hooks/router";
import { failureRates, relativeTime, timeRange } from "../logic";
import {
  RangeControl,
  Region,
  severities,
  Severity,
  Time,
} from "../components/common";
import { Icon, PanelTitle, type IconName } from "../components/icons";
import { Timeline } from "../charts/Timeline";
import { BarList } from "../charts/BarList";
import { Donut, type DonutSlice } from "../charts/Donut";
import { Heatmap } from "../charts/Heatmap";
import { Sparkline } from "../charts/Sparkline";
import { Pivot } from "../components/EventsTable";

const categories = [
  ["auth", "Auth", "var(--cat-1)"],
  ["web", "Web", "var(--cat-2)"],
  ["process", "Process", "var(--cat-3)"],
  ["system", "System", "var(--cat-4)"],
  ["network", "Network", "var(--cat-5)"],
  ["other", "Other", "var(--cat-other)"],
] as const;
const outcomes = [
  ["success", "Success", "var(--cat-1)"],
  ["failure", "Failure", "var(--cat-2)"],
  ["unknown", "Unknown", "var(--cat-other)"],
] as const;

export function Overview() {
  const { url } = useRouter();
  const range = url.searchParams.get("range") ?? "24h";
  const alerts = useAlertSummary();
  const { revision } = alerts;
  const bounds = useMemo(() => timeRange(range), [range, revision]);
  const stats = useApi<Stats>("/stats" + query(bounds));
  const week = useMemo(() => timeRange("7d"), [revision]);
  const heat = useApi<Stats>(
    "/stats" + query({ ...week, bucket: 3600000 }),
    revision,
  );
  const recent = useApi<AlertPage>("/alerts?status=open&limit=8", revision);
  const { events, connected, alerts: live } = useLive();
  const [paused, setPaused] = useState(false);
  const frozen = useRef(events);
  if (!paused) frozen.current = events;
  const rows = new Map(recent.data?.alerts.map((a) => [a.id, a]));
  for (const a of live) {
    const old = rows.get(a.id);
    if (!old || a.updated_at >= old.updated_at) rows.set(a.id, a);
  }
  const active = [...rows.values()].filter((a) => a.status === "open")
    .sort((a, b) => b.last_seen - a.last_seen || b.id - a.id);
  const s = stats.data;
  const openSlices: DonutSlice[] = severities.map((label, i) => ({
    key: String(i),
    label,
    value: alerts.data?.open_by_severity[String(i)] ?? 0,
  }));
  const failurePct = s?.total ? ((s.by_outcome.failure ?? 0) / s.total) * 100 : 0;
  return (
    <>
      <div className="page-header">
        <div className="page-title">
          <h1>Overview</h1>
          <p className="subtitle">Security activity at a glance.</p>
        </div>
        <div className="toolbar">
          <RangeControl />
        </div>
      </div>
      <div className="grid-12">
        <Region {...stats} placeholder={<OverviewSkeleton />}>
          {s && (
            <>
              <div className="cell c3">
                <Kpi
                  title="Events"
                  icon="events"
                  tone="events"
                  caption="In selected range"
                  spark={
                    <Sparkline
                      label="Events"
                      values={s.timeline.map((b) => b.total)}
                      format={(v) => Math.round(v).toLocaleString()}
                      color="var(--other)"
                    />
                  }
                >
                  <strong className="kpi-value">{s.total.toLocaleString()}</strong>
                </Kpi>
              </div>
              <div className="cell c3">
                <Kpi
                  title="Failure rate"
                  icon="failure"
                  tone="failure"
                  caption="In selected range"
                  spark={
                    <Sparkline
                      label="Failure rate"
                      values={failureRates(s.timeline)}
                      format={(v) => `${v.toFixed(1)}%`}
                      color="var(--failure)"
                    />
                  }
                >
                  <strong className="kpi-value">{`${failurePct.toFixed(1)}%`}</strong>
                </Kpi>
              </div>
              <div className="cell c3">
                <Region {...alerts}>
                  <Kpi
                    title="Open alerts"
                    icon="alert"
                    tone="alert"
                    sev={0}
                    caption="All severities · current state, all time"
                  >
                    <strong className="kpi-value">
                      {alerts.data?.open.toLocaleString()}
                    </strong>
                  </Kpi>
                </Region>
              </div>
              <div className="cell c3">
                <Region {...alerts}>
                  <Kpi
                    title="High + critical open"
                    icon="alert"
                    tone="critical"
                    sev={3}
                    caption="High and critical · current state, all time"
                  >
                    <strong className="kpi-value">
                      {((alerts.data?.open_by_severity[3] ?? 0) + (alerts.data?.open_by_severity[4] ?? 0)).toLocaleString()}
                    </strong>
                  </Kpi>
                </Region>
              </div>
              <div className="cell c8">
                <Timeline data={s.timeline} bucketMs={s.bucket_ms} />
              </div>
              <div className="cell c4">
                <Region {...alerts}>
                  {alerts.data && (
                    <Donut
                      title="Open alerts by severity"
                      icon="alert"
                      mode="status"
                      caption="open"
                      slices={openSlices}
                    />
                  )}
                </Region>
              </div>
              <div className="cell c4">
                <Donut
                  title="Events by category"
                  icon="pie"
                  caption="events"
                  slices={categories.map(([key, label, color]) => ({
                    key,
                    label,
                    color,
                    value: s.by_category[key] ?? 0,
                  }))}
                />
              </div>
              <div className="cell c4">
                <Donut
                  title="Events by outcome"
                  icon="pie"
                  caption="events"
                  slices={outcomes.map(([key, label, color]) => ({
                    key,
                    label,
                    color,
                    value: s.by_outcome[key] ?? 0,
                  }))}
                />
              </div>
              <div className="cell c4">
                <Donut
                  title="Top sources"
                  icon="network"
                  caption="events"
                  fold={5}
                  slices={s.top_sources.map((t) => ({
                    key: t.value,
                    label: t.value,
                    value: t.count,
                  }))}
                />
              </div>
            </>
          )}
        </Region>
      </div>
      <div className="overview-split">
        <div className="split-main">
          <div className="split-heat">
            <Region
              {...heat}
              placeholder={
                <div className="state skeleton" style={{ height: 240 }} role="status">
                  Loading…
                </div>
              }
            >
              {heat.data && <Heatmap buckets={heat.data.timeline} />}
            </Region>
          </div>
          <div className="split-lists">
            {s ? (
              <>
                <BarList
                  title="Top source IPs"
                  icon="network"
                  mono
                  rows={s.top_src_ips}
                  href={(v) => "/events" + query({ range, src_ip: v })}
                />
                <BarList
                  title="Top users"
                  icon="user"
                  rows={s.top_users}
                  href={(v) => "/events" + query({ range, user: v })}
                />
              </>
            ) : (
              [0, 1].map((i) => (
                <div className="state skeleton" style={{ height: 300 }} role="status" key={i}>
                  Loading…
                </div>
              ))
            )}
          </div>
          <p className="chart-note">
            Top IPs and users include the full hours containing this range.
            Severity counts open alerts, all time.
          </p>
        </div>
        <section className="panel panel-accent split-side">
          <PanelTitle icon="alert">Recent alerts</PanelTitle>
          <Region {...recent}>
            <RecentAlerts rows={active.slice(0, 6)} />
          </Region>
          <Link className="view-all" href="/alerts">
            View all alerts →
          </Link>
        </section>
      </div>
      <div className="grid-12">
        <div className="cell c12">
          <section className="panel panel-accent">
            <div className="section-heading">
              <PanelTitle icon="pulse">Live feed</PanelTitle>
              <button aria-pressed={paused} onClick={() => setPaused(!paused)}>
                {paused ? "Resume" : "Pause"}
              </button>
            </div>
            {frozen.current.length ? (
              <div className="feed table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Time",
                        "Severity",
                        "Source",
                        "Host",
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
                    {frozen.current.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <Time value={e.ts} />
                        </td>
                        <td>
                          <Severity value={e.severity} />
                        </td>
                        <td>{e.source}</td>
                        <td>
                          <Pivot field="host" value={e.host} />
                        </td>
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
              <div className="state">
                {connected
                  ? "Waiting for incoming events…"
                  : "Reconnecting to the live stream…"}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function RecentAlerts({ rows }: { rows: AlertRow[] }) {
  return rows.length ? (
    <div className="recent-list">
      {rows.map((a) => (
        <Link className="recent-row" key={a.id} href={`/alerts/${a.id}`}>
          <div className="recent-top">
            <Severity value={a.severity} />
            <strong className="recent-title" title={a.title}>
              {a.title}
            </strong>
          </div>
          <span className="recent-meta">
            {a.count.toLocaleString()} {a.count === 1 ? "hit" : "hits"} · last{" "}
            {relativeTime(a.last_seen)}
          </span>
        </Link>
      ))}
    </div>
  ) : (
    <p className="state">No open alerts.</p>
  );
}

function Kpi({
  title,
  icon,
  tone,
  sev,
  caption,
  spark,
  children,
}: {
  title: string;
  icon: IconName;
  tone: "events" | "failure" | "alert" | "critical";
  sev?: number;
  caption: string;
  spark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={sev === undefined ? "panel kpi" : `panel kpi sev-${sev}`}>
      <div className="kpi-head">
        <span className={`kpi-chip chip-${tone}`}>
          <Icon name={icon} />
        </span>
        <h2>{title}</h2>
      </div>
      <div className="kpi-main">
        {children}
        {spark}
      </div>
      <p className="kpi-caption">{caption}</p>
    </section>
  );
}

function OverviewSkeleton() {
  const placeholder = (height: number) => (
    <div className="state skeleton" style={{ height }} role="status">
      Loading…
    </div>
  );
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div className="cell c3" key={i}>
          <section className="panel kpi">{placeholder(96)}</section>
        </div>
      ))}
      <div className="cell c8">
        <section className="panel">{placeholder(300)}</section>
      </div>
      <div className="cell c4">
        <section className="panel">{placeholder(300)}</section>
      </div>
      {[0, 1, 2].map((i) => (
        <div className="cell c4" key={i}>
          <section className="panel">{placeholder(300)}</section>
        </div>
      ))}
    </>
  );
}
