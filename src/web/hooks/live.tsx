import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AlertRow, EventRow } from "../api";
import { Link } from "./router";
interface LiveState {
  connected: boolean;
  events: EventRow[];
  alerts: AlertRow[];
  alertRevision: number;
  reconnectRevision: number;
}
const Live = createContext<LiveState>({
  connected: false,
  events: [],
  alerts: [],
  alertRevision: 0,
  reconnectRevision: 0,
});
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({
    connected: false,
    events: [],
    alerts: [],
    alertRevision: 0,
    reconnectRevision: 0,
  });
  const [toasts, setToasts] = useState<AlertRow[]>([]);
  useEffect(() => {
    const stream = new EventSource("/api/stream");
    const seen = new Set<number>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let opened = false;
    stream.onopen = () => {
      const reconnect = opened;
      opened = true;
      setState((s) => ({
        ...s,
        connected: true,
        reconnectRevision: s.reconnectRevision + Number(reconnect),
        alerts: reconnect ? [] : s.alerts,
      }));
    };
    stream.onerror = () => setState((s) => ({ ...s, connected: false }));
    stream.addEventListener("events", (e: MessageEvent<string>) => {
      const batch = JSON.parse(e.data) as { latest: EventRow[] };
      setState((s) => ({
        ...s,
        events: [
          ...new Map(
            [...batch.latest, ...s.events].map((row) => [row.id, row]),
          ).values(),
        ]
          .sort((a, b) => b.ts - a.ts || b.id - a.id)
          .slice(0, 50),
      }));
    });
    stream.addEventListener("alert", (e: MessageEvent<string>) => {
      const alert = JSON.parse(e.data) as AlertRow;
      // A newly created alert has identical creation/update timestamps. Updates never toast.
      if (
        !seen.has(alert.id) &&
        alert.created_at === alert.updated_at &&
        alert.count === 1 &&
        alert.severity >= 3
      ) {
        setToasts((t) => [alert, ...t].slice(0, 3));
        const timer = setTimeout(() => {
          setToasts((t) => t.filter((a) => a.id !== alert.id));
          timers.delete(timer);
        }, 6000);
        timers.add(timer);
      }
      seen.add(alert.id);
      if (seen.size > 10000) seen.delete(seen.values().next().value!);
      setState((s) => ({
        ...s,
        alerts: [alert, ...s.alerts.filter((a) => a.id !== alert.id)].slice(
          0,
          500,
        ),
        alertRevision: s.alertRevision + 1,
      }));
    });
    return () => {
      stream.close();
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <Live value={state}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((a) => (
          <div className="toast" key={a.id}>
            <Link href={`/alerts/${a.id}`}>
              {a.severity === 4 ? "Critical" : "High"} alert: {a.title}
            </Link>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((t) => t.filter((x) => x.id !== a.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </Live>
  );
}
export const useLive = () => useContext(Live);
export function useRefresh() {
  const { alertRevision, reconnectRevision } = useLive();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setRevision((n) => n + 1);
    };
    const interval = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (!alertRevision) return;
    const timer = setTimeout(() => {
      if (!document.hidden) setRevision((n) => n + 1);
    }, 2200);
    return () => clearTimeout(timer);
  }, [alertRevision]);
  return revision + reconnectRevision;
}
