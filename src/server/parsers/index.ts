import { base, type NormalizedEventInput, type ParseContext } from "../schema";
import { parseSshd } from "./sshd";
import { parseSudo, parseUserManagement } from "./sudo";
import { parseAccessLog } from "./access-log";
import { parseSyslog } from "./syslog";
export const MAX_RAW_LINE_BYTES = 8192;
export function boundedRaw(raw: string) {
  const line = raw.replace(/(?:\r\n|[\r\n])$/, "");
  const bytes = Buffer.from(line);
  return { raw: bytes.subarray(0, MAX_RAW_LINE_BYTES).toString("utf8").replace(/\uFFFD$/, ""), truncated: bytes.length > MAX_RAW_LINE_BYTES };
}
export function parseLine(
  line: string,
  ctx: ParseContext = {},
): NormalizedEventInput {
  const bounded = boundedRaw(line);
  line = bounded.raw;
  const header = parseSyslog(line, ctx);
  const message = header?.message ?? line;
  const invalidHeader = !header && /^(?:<\d+>|1 \S+ |[A-Z][a-z]{2} \s*\d)/.test(line);
  const context = header?.context ?? (invalidHeader ? { ...ctx, ts: ctx.now ?? Date.now() } : ctx);
  const tag = context.source?.toLowerCase();
  const parsers = header
    ? tag === "sshd"
      ? [parseSshd]
      : tag === "sudo"
        ? [parseSudo]
        : ["useradd", "usermod", "groupadd"].includes(tag ?? "")
          ? [parseUserManagement]
          : ["nginx", "apache", "apache2", "httpd"].includes(tag ?? "")
            ? [parseAccessLog]
            : []
    : invalidHeader ? [] : [parseSshd, parseSudo, parseUserManagement, parseAccessLog];
  const e =
    parsers
      .map((parser) => parser(message, context))
      .find((event) => event !== null) ??
    base(message, {
      ...context,
      source: context.source ?? (header ? "syslog" : "app"),
    });
  if (header && e.category === "other") e.category = "system";
  e.raw = line;
  if (bounded.truncated) e.fields.truncated = true;
  return e;
}
