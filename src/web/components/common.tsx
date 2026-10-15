import type { ReactNode } from "react";
import { ranges } from "../logic";
import { useRouter } from "../hooks/router";
export const severities = ["Info", "Low", "Medium", "High", "Critical"];
export function Severity({ value }: { value: number }) {
  return (
    <span className={`severity sev-${value}`}>
      <span aria-hidden="true">◆</span> {severities[value] ?? value}
    </span>
  );
}
export function Region({
  loading,
  error,
  retry,
  children,
  data,
  placeholder,
}: {
  loading: boolean;
  error?: string;
  retry: () => void;
  children?: ReactNode;
  data?: unknown;
  placeholder?: ReactNode;
}) {
  if (error)
    return (
      <div className="state error" role="alert">
        {error} <button onClick={retry}>Retry</button>
      </div>
    );
  if (loading && data === undefined)
    return (
      placeholder ?? (
        <div className="state skeleton" role="status">
          Loading…
        </div>
      )
    );
  return <>{children}</>;
}
export function Time({ value }: { value: number }) {
  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={new Date(value).toLocaleString()}
    >
      {new Date(value).toLocaleTimeString()}
    </time>
  );
}
export function RangeControl() {
  const { url, navigate } = useRouter();
  const range = url.searchParams.get("range") ?? "24h";
  return (
    <label>
      Time range{" "}
      <select
        value={range}
        onChange={(e) => {
          const p = new URLSearchParams(url.search);
          p.set("range", e.target.value);
          p.delete("from");
          p.delete("to");
          navigate(url.pathname + "?" + p);
        }}
      >
        {ranges.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
    </label>
  );
}
export function MinimumSeverity({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      Min severity
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any severity</option>
        {severities.map((s, i) => (
          <option value={i} key={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
