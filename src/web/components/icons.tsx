import type { ReactNode } from "react";

export type IconName =
  | "events"
  | "failure"
  | "alert"
  | "chart"
  | "pie"
  | "network"
  | "user"
  | "grid"
  | "pulse"
  | "list";

const shapes: Record<IconName, ReactNode> = {
  events: <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />,
  failure: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M6 6l4 4M10 6l-4 4" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.25l6 10.5H2z" />
      <path d="M8 6.5v2.75" />
      <path d="M8 11.25h.01" />
    </>
  ),
  chart: (
    <>
      <path d="M2.5 2.5v11h11" />
      <path d="M5 10.5l2.5-3 2.5 2 3.5-4.5" />
    </>
  ),
  pie: (
    <>
      <path d="M13.5 9.5A5.75 5.75 0 1 1 6.5 2.5v6.2z" />
      <path d="M9 2.4a5.75 5.75 0 0 1 4.6 4.6H9z" />
    </>
  ),
  network: (
    <>
      <circle cx="8" cy="3.5" r="1.75" />
      <circle cx="3.5" cy="12.5" r="1.75" />
      <circle cx="12.5" cy="12.5" r="1.75" />
      <path d="M8 5.25V8M8 8l-3.25 2.75M8 8l3.25 2.75" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M3 13.5c.6-2.5 2.6-3.75 5-3.75s4.4 1.25 5 3.75" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  pulse: <path d="M1.75 8h3l1.75-3.75L9.25 12l1.75-4h3" />,
  list: <path d="M6 4h7.5M6 8h7.5M6 12h7.5M3 4h.01M3 8h.01M3 12h.01" />,
};

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}

export function PanelTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="panel-title">
      <span className="panel-icon">
        <Icon name={icon} />
      </span>
      <h2>{children}</h2>
    </div>
  );
}
