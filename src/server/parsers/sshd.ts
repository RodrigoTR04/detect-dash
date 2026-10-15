import { base, type Parser } from "../schema";
export const parseSshd: Parser = (line, ctx) => {
  const login =
    /^(Failed|Accepted) (password|publickey|keyboard-interactive\/pam) for (invalid user )?(\S+) from (\S+)(?: port (\d+))?/.exec(
      line,
    );
  const invalid = /^Invalid user (\S+) from (\S+)(?: port (\d+))?/.exec(line);
  const teardown =
    /^(?:Connection closed by|Disconnected from|Received disconnect from)\b/.test(
      line,
    );
  const disconnect =
    /^(?:Connection closed by|Disconnected from|Received disconnect from) (?:authenticating user |invalid user |user )?(?:(\S+) )?([\da-fA-F:.]+)(?: port (\d+))?(?=[:\s]|$)/.exec(
      line,
    );
  const pam = /^pam_unix\(sshd:auth\): authentication failure;/.test(line);
  if (!login && !invalid && !teardown && !pam) return null;
  const e = base(line, { ...ctx, source: "sshd" });
  e.category = "auth";
  e.action = login
    ? "login"
    : invalid
      ? "invalid_user"
      : pam
        ? "pam_auth_failure"
        : "disconnect";
  e.outcome =
    login?.[1] === "Accepted" ? "success" : teardown ? "unknown" : "failure";
  e.severity = invalid ? 2 : e.outcome === "failure" ? 1 : 0;
  e.user =
    login?.[4] ??
    invalid?.[1] ??
    disconnect?.[1] ??
    /\buser=(\S+)/.exec(line)?.[1] ??
    null;
  e.src_ip =
    login?.[5] ??
    invalid?.[2] ??
    disconnect?.[2] ??
    /\brhost=(\S+)/.exec(line)?.[1] ??
    null;
  e.fields.invalid_user = Boolean(invalid || login?.[3]);
  if (login) e.fields.method = login[2];
  const port = login?.[6] ?? invalid?.[3] ?? disconnect?.[3];
  if (port) e.fields.port = Number(port);
  return e;
};
