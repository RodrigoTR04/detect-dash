# Changelog

## 0.1.0 - 2026-10-15

### Added

- HTTP JSON, NDJSON, and raw log ingestion.
- UDP syslog with sshd, sudo, user-management, and access-log parsers.
- SQLite event storage, retention, and minute/hour rollups.
- Nine detection rules with MITRE technique IDs and linked evidence.
- Alert triage and live server-sent events.
- React dashboard with area, donut, heatmap, and sparkline charts, themes, and shareable filters.
- Traffic simulator, benchmark, and optional Tailscale binding.

### Security

- Split sudo fields without overlapping regex repetitions and cap raw lines at 8 KiB.
- Limit SSE subscribers and disconnect clients with excessive queued data.
- Require mutation content types and reject mismatched Origin hosts.
- Store and flag future timestamps while excluding them from detection.
- Version rollup migrations and rebuild them atomically.
- Handle syslog trailing newlines and reject invalid header timestamps.

### Known limitations

- No authentication or authorization. Trusted networks only.
- Detection windows reset on restart or rule toggle.
- Detection state is bounded and can drop older groups or evidence under load.
- UDP delivery is lossy.
