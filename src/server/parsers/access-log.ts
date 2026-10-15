import { base, type Parser } from "../schema";
export const parseAccessLog: Parser = (line, ctx) => {
  const m =
    /^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) (.*?) HTTP\/[\d.]+" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"$/.exec(
      line,
    );
  if (!m) return null;
  const stamp = m[3]!.replace(/^(\d+)\/(\w+)\/(\d+):/, "$1 $2 $3 ");
  const ts = Date.parse(stamp);
  if (!Number.isFinite(ts)) return null;
  const e = base(line, {
    ...ctx,
    ts: ctx.ts ?? ts,
    source: ctx.source ?? "nginx",
  });
  e.category = "web";
  e.action = "http_request";
  e.src_ip = m[1]!;
  e.user = m[2] === "-" ? null : m[2]!;
  const status = Number(m[6]);
  e.outcome = status >= 400 ? "failure" : "success";
  e.severity = status >= 500 ? 1 : 0;
  Object.assign(e.fields, {
    method: m[4],
    path: m[5],
    status,
    bytes: m[7] === "-" ? null : Number(m[7]),
    referer: m[8],
    user_agent: m[9],
  });
  return e;
};
