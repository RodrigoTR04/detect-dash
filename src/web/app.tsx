import { useEffect, useState } from "react";
import { RouterProvider, Link, useRouter } from "./hooks/router";
import { LiveProvider, useLive } from "./hooks/live";
import {
  AlertSummaryProvider,
  useAlertSummary,
} from "./hooks/alertSummary";
import { matchPath } from "./logic";
import { Overview } from "./pages/Overview";
import { Events } from "./pages/Events";
import { Alerts, AlertView } from "./pages/Alerts";
import { Rules } from "./pages/Rules";
function Shell() {
  const { url } = useRouter();
  const route = matchPath(url.pathname);
  const { connected } = useLive();
  const inventory = useAlertSummary();
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      return saved && ["system", "light", "dark"].includes(saved)
        ? saved
        : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* Storage can be disabled by browser policy. */
    }
  }, [theme]);
  useEffect(() => {
    document.title = `${route.page === "detail" ? "Alert" : route.page[0]!.toUpperCase() + route.page.slice(1)} · detect-dash`;
  }, [route.page]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <Link className="brand" href="/">
          <svg
            className="brand-mark"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
          >
            <rect width="20" height="20" rx="5" fill="currentColor" />
            <path
              className="cut"
              d="M4.5 13.5l3.2-3.4 2.6 2.4 5.2-5.6"
              fill="none"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          detect-dash
        </Link>
        <nav aria-label="Main navigation">
          {[
            ["/", "Overview"],
            ["/events", "Events"],
            ["/alerts", "Alerts"],
            ["/rules", "Rules"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              aria-current={
                (
                  href === "/"
                    ? url.pathname === "/"
                    : url.pathname.startsWith(href!)
                )
                  ? "page"
                  : undefined
              }
            >
              {label}
              {label === "Alerts" && (
                <span
                  className="count"
                  title={inventory.error ?? "Open alerts"}
                >
                  {inventory.loading && !inventory.data
                    ? "…"
                    : inventory.error
                      ? "!"
                      : (inventory.data?.open.toLocaleString() ?? 0)}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <span className="live-label">
            <i className={connected ? "live-dot" : "live-dot reconnecting"} />
            {connected ? "Live" : "Reconnecting"}
          </span>
          <div className="segmented" role="group" aria-label="Theme">
            {(
              [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main id="main">
        {inventory.error && route.page !== "overview" && (
          <div className="error" role="alert">
            Open alert count: {inventory.error}{" "}
            <button onClick={inventory.retry}>Retry</button>
          </div>
        )}
        {route.page === "overview" ? (
          <Overview />
        ) : route.page === "events" ? (
          <Events />
        ) : route.page === "alerts" ? (
          <Alerts />
        ) : route.page === "detail" ? (
          <AlertView key={route.id} id={route.id!} />
        ) : route.page === "rules" ? (
          <Rules />
        ) : (
          <>
            <h1>Page not found</h1>
            <Link href="/">Return to overview</Link>
          </>
        )}
      </main>
      <footer>
        detect-dash <span>Local security telemetry</span>
      </footer>
    </>
  );
}
export function App() {
  return (
    <RouterProvider>
      <LiveProvider>
        <AlertSummaryProvider>
          <Shell />
        </AlertSummaryProvider>
      </LiveProvider>
    </RouterProvider>
  );
}
