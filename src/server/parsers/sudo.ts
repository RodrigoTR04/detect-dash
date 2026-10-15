import { base, type Parser } from "../schema";
export const parseSudo: Parser = (line, ctx) => {
  const prefix = /^\s*(\S+)\s*:\s*TTY=/.exec(line);
  const parts = new Map<string, string>();
  if (prefix) {
    const fields = line.slice(prefix[0].length - 4).split(";");
    for (let i = 0; i < fields.length; i++) {
      const part = fields[i]!;
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === "COMMAND") {
        parts.set(key, [value, ...fields.slice(i + 1)].join(";"));
        break;
      }
      parts.set(key, value);
    }
  }
  const command = prefix && ["TTY", "PWD", "USER", "COMMAND"].every(key => parts.has(key))
    ? [line, prefix[1], parts.get("PWD"), parts.get("USER"), parts.get("COMMAND")]
    : null;
  const pam = /^pam_unix\(sudo(?:-i)?:auth\): authentication failure;/i.test(
    line,
  );
  const attempts = /^\s*(\S+)\s*:\s*(\d+) incorrect password attempts\b/i.exec(
    line,
  );
  const failure = pam || Boolean(attempts);
  if (!command && !failure) return null;
  const e = base(line, { ...ctx, source: "sudo" });
  e.category = "process";
  e.action = pam ? "pam_auth_failure" : "sudo";
  e.outcome = failure ? "failure" : "success";
  e.severity = pam ? 1 : failure ? 2 : 0;
  if (attempts) e.fields.attempts = Number(attempts[2]);
  e.user =
    command?.[1] ??
    /\buser=(\S+)/.exec(line)?.[1] ??
    /^\s*([\w.-]+)\s*:/.exec(line)?.[1] ??
    null;
  const target = /\bUSER=(\S+)/.exec(line)?.[1];
  const executed = /\bCOMMAND=(.*)$/.exec(line)?.[1];
  if (target) e.fields.target_user = target;
  if (executed) e.fields.command = executed;
  if (command)
    Object.assign(e.fields, {
      pwd: command[2],
      target_user: command[3],
      command: command[4],
    });
  return e;
};
export const parseUserManagement: Parser = (line, ctx) => {
  const added = /^new user:.*?\bname=([^,\s]+)/.exec(line);
  const group =
    /^add ["\x27]([^"\x27]+)["\x27] to (?:group|shadow group) ["\x27]([^"\x27]+)["\x27]/.exec(
      line,
    );
  const newGroup = /^new group:.*?\bname=([^,\s]+)/.exec(line);
  if (!added && !group && !newGroup) return null;
  const e = base(line, {
    ...ctx,
    source: ctx.source ?? (added ? "useradd" : group ? "usermod" : "groupadd"),
  });
  e.category = "auth";
  e.action = added ? "user_add" : "group_add";
  e.outcome = "success";
  e.user = added?.[1] ?? group?.[1] ?? null;
  e.fields.group = group?.[2] ?? newGroup?.[1];
  e.severity = ["sudo", "wheel", "admin"].includes(String(e.fields.group))
    ? 3
    : 2;
  return e;
};
