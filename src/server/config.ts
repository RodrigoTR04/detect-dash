function integer(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max || raw === "")
    throw new Error(`Invalid ${name}`);
  return value;
}
export function config() {
  return {
    maxFutureSkewMs: integer("MAX_FUTURE_SKEW_MS", 300000, 0, Number.MAX_SAFE_INTEGER),
    port: integer("PORT", 8080, 0, 65535),
    syslogPort: integer("SYSLOG_PORT", 5514, 0, 65535),
    dbPath: process.env.DB_PATH ?? "./data/siem.db",
    retentionDays: integer("RETENTION_DAYS", 7, 1, 36500),
    host: process.env.HOST ?? "127.0.0.1",
  };
}
