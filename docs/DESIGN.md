# Backend design

Run `bun install`, `bun run dev`, then `bun run simulate --backfill 2 --duration 20`.
Bun 1.3 is the runtime. React 19 and React DOM are the dashboard runtime packages.
`bun run typecheck` and `bun test` check the implementation.

## Configuration and lifetime

| Environment    | Default        | Meaning                         |
| -------------- | -------------- | ------------------------------- |
| HOST           | 127.0.0.1      | HTTP and UDP bind address       |
| PORT           | 8080           | HTTP port                       |
| SYSLOG_PORT    | 5514           | UDP syslog port; 0 disables it  |
| DB_PATH        | ./data/siem.db | SQLite file                     |
| MAX_FUTURE_SKEW_MS | 300000 | Maximum future detection skew in milliseconds |
| RETENTION_DAYS | 7              | Positive integer number of days |

`createApp({dbPath, retentionDays})` in `src/server/api.ts` exports a Fetch handler,
manual ingestion, database, engine, and `close()`. It defaults to an in-memory
SQLite database and opens no network sockets. `index.ts` owns HTTP and UDP
listeners. SIGINT and SIGTERM close listeners, subscriptions, timers, and SQLite.
A transaction at startup and hourly deletes expired events and closed alerts by event time.
Foreign keys cascade deletions into `alert_events`. Open and acknowledged alerts
remain, even if retention removes their evidence.

## Storage

SQLite uses WAL, foreign keys, cached prepared statements, and transactions for
batch event inserts. `events` stores `id`, `ts`, `ingested_at`, `source`, `host`,
`category`, `action`, `outcome`, `severity`, nullable `src_ip`, `dst_ip`, `user`,
`message`, `fields`, and `raw`. Both timestamps are integer epoch milliseconds.
`fields` is a JSON object stored as text and decoded in API responses. Category,
outcome, and severity have database constraints. Indexes cover `ts` and the pairs
`src_ip/ts`, `user/ts`, `category/ts`, and `source/ts`.

`alerts` stores `id`, `rule_id`, `rule_name`, `severity`, `mitre`, `group_key`,
`title`, `first_seen`, `last_seen`, `count`, `status`, `created_at`, `updated_at`.
`alert_events` links up to 100 event IDs per alert. `count` counts qualifying
rule evaluations, including suppressed evaluations, rather than unique evidence.
`rule_state(rule_id, enabled)` preserves enablement across restarts.

## Ingestion and parsing

`POST /api/ingest` accepts an object, array, or `application/x-ndjson` body.
Limits are 5 MiB and 5,000 items. Results contain `accepted`, `rejected`, and
up to 50 `{index,error}` entries. Malformed JSON rejects the request; malformed
NDJSON lines and invalid array items reject only those items. Item indexes in
NDJSON count nonblank lines. Missing normalized fields default to current time,
app source, unknown host, other category, log action, unknown outcome, and
severity 0. Numeric strings are accepted for timestamps and severity; timestamps
also accept date strings. Nullable identity and IP fields must be strings or null.

Objects containing `raw` without category, action, or message use the raw parsers.
Optional source and host supply context. An explicit `ts` supplies event time for
bare raw lines, including access logs, so the simulator can backfill history.
Syslog headers supply their own timestamp and host. Program parsers determine
semantic severity; generic syslog messages use PRI severity mapped to 0..4.
RFC 3164 times use the server local timezone and current year, subtracting a year
if the result is over one day in the future. RFC 5424 keeps PID, message ID, and
structured data in `fields`. Header tags select sshd, sudo, user/group management,
or access parsers. Bare lines try all parsers. Unmatched lines always survive.
UDP datagrams use the same ingestion pipeline, one line per datagram.

## Detection rules

Rules in `src/server/detection/rules.ts` are typed data. All nine built-in rules
are enabled initially. Every rule supplies ID, name, description, severity,
MITRE technique, and `groupBy` field paths. Group keys are JSON arrays of values;
missing or empty group values skip evaluation.

Conditions support `{field, op, value}`, with `equals`, `in`, `regex`, `gte`, and
`lte`. Combinators are `{all:[...]}`, `{any:[...]}`, and `{not:condition}`.
Paths select top-level event properties or a direct `fields.<key>`. Regex
conditions accept `flags` and `decode:true`, which URL-decodes once. Malformed
escapes leave the original string intact. Rules contain no evaluated JS strings.

- `match` evaluates one `condition` per event.
- `threshold` adds `windowMs`, `threshold`, and optional `distinct` field path.
- `sequence` adds `a`, `b`, `windowMs`, and `threshold`: that many A events must
  precede B in the same group and time window.

The engine sorts each batch by `ts`, then ID. Per-group windows retain modestly
late events inside the current watermark window; evaluations count evidence at
or before the triggering timestamp. A late A does not retroactively reevaluate
an already processed B. Windows expire by event time, cap at 5,000 entries per
group, and cap at 10,000 keys per rule with least recently used eviction. These
caps deliberately trade completeness under overload for bounded memory. Window
state resets on restart and on rule toggles. Stored alert suppression survives
restarts. Suppression updates an open or acknowledged alert when its last event time is within
`suppressMs` of the trigger, defaulting to `windowMs` or ten minutes. Closed alerts do not suppress new alerts.

## HTTP API

All responses are JSON except SSE. Invalid inputs return a 4xx `{error}` response.
Unknown or duplicate query parameters are rejected. The server entry point serves dashboard HTML on `/`, `/events`, `/alerts`, `/alerts/:id`, and `/rules`; other non-API paths return 404.

| Route                 | Behavior                                                   |
| --------------------- | ---------------------------------------------------------- |
| GET /api/health       | ok, uptime_s, events_total                                 |
| POST /api/ingest      | Batch result described above                               |
| GET /api/events       | events and next_cursor                                     |
| GET /api/events/:id   | Event with raw and associated alerts                       |
| GET /api/stats        | Aggregates, zero-filled timeline, top values, alert counts |
| GET /api/alerts       | alerts and next_cursor                                     |
| GET /api/alerts/summary | Current all-time status counts and open_by_severity (0..4); no query parameters |
| GET /api/alerts/:id   | Alert with associated events                               |
| PATCH /api/alerts/:id | `{status: "open" or "acknowledged" or "closed"}`           |
| GET /api/rules        | `{rules:[...]}` with enabled, alerts_total and alerts_open |
| PATCH /api/rules/:id  | `{enabled:boolean}`                                        |
| GET /api/stream       | SSE events and alert updates                               |

Events accept `from`, `to`, `q`, `category`, `source`, `outcome`, `severity_min`,
`src_ip`, `user`, `host`, `limit`, `cursor`. Times are nonnegative integer epoch
milliseconds, inclusive, defaulting to the last 24 hours. `q` uses SQLite LIKE
with escaped wildcards, so `%` and `_` are literal and ASCII case is ignored.
Limit defaults to 100, maximum 500. Events sort by ts DESC, id DESC. Cursors are
base64url JSON `[ts,id]`; reuse the same filters and time bounds on later pages.

Alerts accept `status`, `severity_min`, `rule_id`, `limit`, and `cursor`, sorting
by last_seen DESC, id DESC. Their cursor encodes `[last_seen,id]`. Alert updates
can move rows between pages while ingestion continues.

Stats accept `from`, `to`, and `bucket`. Explicit buckets must be positive
multiples of 60,000 milliseconds or return 400. Defaults choose the nice interval
closest to 90 buckets from 1m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, and 1d. Typical
ranges yield 60–120 buckets. Some ranges cannot meet those bounds with this fixed
interval set, and ranges shorter than an hour cannot produce 60 minute buckets.
Buckets align to epoch boundaries; the response includes `bucket_ms` and is
limited to 10,001 output buckets. Empty buckets have total/failure 0. Severity,
category, and outcome maps include zero values. Top IPs, users, and sources have
at most ten entries. Top IP and user lists include the entire hours containing
`from` and `to`; their time bounds are hour-aligned. Other event aggregates are
exact for the inclusive requested bounds, including partial minutes. Alert aggregates cover alerts overlapping the time range;
`alerts_open` counts open alerts, `alerts_by_severity` includes every status.

SSE sends `event: events` with `{count,latest}` at most once per 500 ms, with the
latest 20 ingested events. `event: alert` includes each created or updated alert,
including status changes. Comments keep connections alive every 15 seconds.
Abort, stream cancellation, and application shutdown remove subscriptions.

## Rollups and detection cost

`event_rollup(minute, category, source, outcome, severity, count)` uses a composite
primary key and minute epoch boundaries. `entity_rollup(hour, kind, value, count)`
uses hour boundaries and kinds `src_ip` and `user`. Batch inserts aggregate keys
in memory and upsert both tables inside the event insert transaction. Existing
databases populate both rollups once on first open after migration.
Stats read minute rollups once for totals, severity, category, outcome, timeline,
and sources. At most two partial minutes read raw events to preserve exact
inclusive bounds. Entity top lists read hourly rollups. Retention deletes old
rollups and rebuilds the cutoff minute and hour from surviving events.

Rule enablement loads once at engine construction and changes through
`setEnabled`, which persists the flag and clears that rule's windows. Conditions
cache compiled regexes by object identity, resetting regex state before use.
Idle groups sweep at most once per rule window of event-time advance. Entries
remain timestamp-sorted with binary insertion for late events and front expiry.
Binary bounds count ordinary thresholds without scanning the window. Distinct
thresholds cache value frequencies for chronological events; late-event evaluations
scan the qualifying prefix. Expiry adjusts frequencies only for removed entries.
Alert evidence reads at most 100 qualifying IDs.
The existing 5,000-entry and 10,000-group limits remain.

## Authentication semantics

SSH failed and accepted password, publickey, and keyboard-interactive/pam messages
are login attempts. Invalid-user notices use `invalid_user`, PAM auth failures use
`pam_auth_failure`, and teardown messages use `disconnect` with unknown outcome
and severity zero. SSH threshold and sequence conditions require `action=login`
as well as the source and outcome. Companion lines cannot inflate attempt counts.
The invalid-user match groups by IP; linked event evidence retains usernames.

Sudo PAM parsing requires `pam_unix(sudo:auth)` or `pam_unix(sudo-i:auth)` and uses
`pam_auth_failure`. Incorrect-password summaries use `sudo` with severity 2 and
`fields.attempts`. Only failed `sudo` actions count toward the sudo threshold.
Bare SSH PAM lines are parsed as SSH, never sudo.

## Simulator and benchmark

The simulator uses only documentation/private address ranges. `--seed` accepts an
integer, defaults to a random seed, and prints the seed for replay. Weighted benign
traffic includes eight SSH users, private client addresses, isolated typos followed
by success, disconnects, thirty nginx clients, varied paths/statuses/methods/user
agents, admin sudo commands, JSON app actions, and about 0.1% user creation.
About 30% of program log lines carry local-time RFC 3164 headers. Access timestamps
use the event's UTC time. Typos have a twenty-minute cooldown per IP.

`--attack-interval` is the mean number of seconds between scenario starts,
default 45, sampled exponentially. Each start chooses one of eight scenarios:
brute force, brute force then success, spraying, web scan, injection probes,
privileged group change, sudo failures, or an outage on one host. Attackers use
random addresses in 203.0.113.0/24 and 198.51.100.0/24. Scenarios queue timestamped
events over seconds and run alongside benign traffic. Backfill advances the same
scheduler without sleeping; live ticks emit due events with current timestamps.
Existing `--url`, `--rate`, `--duration`, and `--backfill` flags remain.

`bun scripts/bench.ts` seeds a temporary file-backed database with 1.7 million
events spread across 24 hours through `insertEvents`, then measures Fetch API
stats and first-page event requests, including text and IP filters. It reports
first and median latency over five requests, including JSON response parsing.


## Dashboard

`src/web/index.html` is imported by `src/server/index.ts` and served through Bun
HTML routes. API requests still use the existing Fetch handler. Development mode
follows `NODE_ENV !== "production"` and supports Bun HMR without a separate bundler.

`api.ts` mirrors backend response types and omits empty query values. `useApi`
uses AbortController and checks cancellation before applying results. It retains
previous data during refreshes to avoid collapsing charts and tables. Errors show
an inline retry. The history router tracks pathname and search through React
context and the browser popstate event. Event filters are allowlisted before
sending them to the API, so UI-only range parameters never reach the backend.
Search text waits 300 ms. Each event view holds fixed from/to bounds while loading
cursor pages. Identity links preserve event filters when pivoting within Events.

A single EventSource lives in LiveProvider. It keeps the latest 50 events and a
bounded cache of alert updates, and exposes live/reconnecting status. Alert lists
merge updates by ID and update timestamp, remove rows that no longer match their
filters, and sort by last_seen/id. New high and critical alerts produce up to
three notifications for six seconds. Creation/update timestamps distinguish new
alerts from updates. A pause freezes the displayed feed while the shared stream
continues to receive data.

Stats refresh every 15 seconds and 2.2 seconds after alert activity settles.
Timers skip requests while the document is hidden; becoming visible refreshes.
The dashboard reads `/api/alerts/summary` for all-time status and severity counts
and `/api/alerts?status=open&limit=8` for recent open alerts. SSE merges alert
updates into the recent list and triggers summary refreshes. The regular refresh
cadence is 15 seconds, with a refresh 2.2 seconds after alert activity settles.
Hidden documents skip polling and refresh when visible.

Charts use handwritten SVG and ResizeObserver. Timeline series have fixed blue
other/orange failure colors, one numeric axis, full-height hover targets, keyboard
focus tooltips, and an equivalent HTML table. Severity always includes text and a
diamond. CSS variables define both system and explicit themes. Dense tables scroll
within their panels and overview columns collapse below 1024px. The event dialog
traps focus, restores its opener, and closes with Escape. Alert and rule mutations
apply optimistically, disable duplicate actions, and roll back with inline errors.

`test/web.test.ts` covers query omission/encoding, range bounds, nice ticks,
time-axis labels, relative time, MITRE sub-technique URLs, and route matching.


## Release security limits

Raw lines lose one trailing LF, CR, or CRLF before parsing and storage. Parsing
and stored raw are capped at 8192 UTF-8 bytes, with `fields.truncated=true` when
the cap is exceeded. HTTP raw items and UDP share this path. Sudo command fields
are split on semicolons before reading key/value pairs. The remaining parser
and built-in rule regexes were checked for overlapping repetitions.

SSE allows 50 concurrent subscribers. A byte-sized stream queue has a 1 MiB
budget, charging at least 1049 bytes per message to bound it below 1000 messages.
Clients exceeding that budget are disconnected and their queued data discarded.

POST/PATCH ingest, alert, and rule mutations require `application/json` or
`application/x-ndjson`, otherwise returning 415. A present Origin must have the
same host and port as the request Host, otherwise returning 403. Requests without
Origin are allowed. These checks do not provide authentication.

Events beyond now plus `MAX_FUTURE_SKEW_MS` are stored with
`fields.future_ts=true` but excluded from detection and watermark advancement.

SQLite `PRAGMA user_version=1` marks the rollup schema. Startup creates and
backfills rollups in one transaction and writes the version last. An older or
missing marker rebuilds both rollups from events, including after interruption.
