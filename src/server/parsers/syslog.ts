import type { ParseContext } from "../schema";
export interface SyslogHeader {
  message: string;
  context: ParseContext;
}
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function parseSyslog(
  line: string,
  ctx: ParseContext = {},
): SyslogHeader | null {
  const pri = /^<(\d{1,3})>/.exec(line);
  if (pri && Number(pri[1]) > 191) return null;
  const text = pri ? line.slice(pri[0].length) : line;
  const severity = pri
    ? [4, 4, 4, 3, 2, 1, 0, 0][Number(pri[1]) % 8]
    : undefined;
  const modern =
    /^1 (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[(?:[^"\]\\]|\\.|"(?:[^"\\]|\\.)*")*\])+) ?(.*)$/.exec(
      text,
    );
  if (modern) {
    const ts =
      modern[1] === "-" ? (ctx.now ?? Date.now()) : Date.parse(modern[1]!);
    if (!Number.isSafeInteger(ts) || ts < 0) return null;
    return {
      message: modern[7]!,
      context: {
        ...ctx,
        ts,
        host: modern[2] === "-" ? "unknown" : modern[2],
        source: modern[3] === "-" ? "syslog" : modern[3],
        severity,
        fields: {
          ...ctx.fields,
          pid: modern[4] === "-" ? null : modern[4],
          msgid: modern[5],
          structured_data: modern[6],
        },
      },
    };
  }
  const old =
    /^(\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\S+) ([\w./-]+)(?:\[(\d+)\])?: ?(.*)$/.exec(
      text,
    );
  if (!old || !months.includes(old[1]!)) return null;
  if (
    Number(old[2]) < 1 ||
    Number(old[2]) > 31 ||
    Number(old[3]) > 23 ||
    Number(old[4]) > 59 ||
    Number(old[5]) > 59
  )
    return null;
  const now = ctx.now ?? Date.now();
  const date = new Date(now);
  date.setMonth(months.indexOf(old[1]!), Number(old[2]));
  date.setHours(Number(old[3]), Number(old[4]), Number(old[5]), 0);
  if (date.getMonth() !== months.indexOf(old[1]!) || date.getDate() !== Number(old[2])) return null;
  if (date.getTime() > now + 86400000) date.setFullYear(date.getFullYear() - 1);
  if (date.getMonth() !== months.indexOf(old[1]!) || date.getDate() !== Number(old[2]) || date.getTime() < 0) return null;
  return {
    message: old[9]!,
    context: {
      ...ctx,
      ts: date.getTime(),
      host: old[6],
      source: old[7],
      severity,
      fields: { ...ctx.fields, pid: old[8] ? Number(old[8]) : null },
    },
  };
}
