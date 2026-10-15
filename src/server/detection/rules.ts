export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      field: string;
      op: "equals" | "in" | "regex" | "gte" | "lte";
      value: unknown;
      flags?: string;
      decode?: boolean;
    };
interface RuleBase {
  id: string;
  name: string;
  description: string;
  severity: number;
  mitre: string;
  groupBy: string[];
  windowMs?: number;
  suppressMs?: number;
}
export type Rule = RuleBase &
  (
    | { kind: "match"; condition: Condition }
    | {
        kind: "threshold";
        condition: Condition;
        threshold: number;
        windowMs: number;
        distinct?: string;
      }
    | {
        kind: "sequence";
        a: Condition;
        b: Condition;
        threshold: number;
        windowMs: number;
      }
  );
const eq = (field: string, value: unknown): Condition => ({
  field,
  op: "equals",
  value,
});
const all = (...conditions: Condition[]): Condition => ({ all: conditions });
const sshFailure = all(
  eq("source", "sshd"),
  eq("action", "login"),
  eq("outcome", "failure"),
);
const minute = 60000;
export const rules: Rule[] = [
  {
    id: "ssh-brute-force",
    name: "SSH brute force",
    description: "Five failed SSH logins from an IP in five minutes",
    kind: "threshold",
    condition: sshFailure,
    threshold: 5,
    windowMs: 5 * minute,
    groupBy: ["src_ip"],
    severity: 3,
    mitre: "T1110.001",
  },
  {
    id: "password-spraying",
    name: "Password spraying",
    description: "Five distinct users fail SSH login from an IP in ten minutes",
    kind: "threshold",
    condition: sshFailure,
    threshold: 5,
    distinct: "user",
    windowMs: 10 * minute,
    groupBy: ["src_ip"],
    severity: 3,
    mitre: "T1110.003",
  },
  {
    id: "brute-force-success",
    name: "Brute force followed by success",
    description: "Three failed SSH logins followed by success",
    kind: "sequence",
    a: sshFailure,
    b: all(
      eq("source", "sshd"),
      eq("action", "login"),
      eq("outcome", "success"),
    ),
    threshold: 3,
    windowMs: 15 * minute,
    groupBy: ["src_ip"],
    severity: 4,
    mitre: "T1078",
  },
  {
    id: "invalid-user",
    name: "Login with invalid user",
    description: "SSH login names a nonexistent user",
    kind: "match",
    condition: all(eq("source", "sshd"), eq("fields.invalid_user", true)),
    groupBy: ["src_ip"],
    severity: 1,
    mitre: "T1110.001",
  },
  {
    id: "sudo-failures",
    name: "Sudo authentication failures",
    description: "Three sudo failures by a user in five minutes",
    kind: "threshold",
    condition: all(
      eq("source", "sudo"),
      eq("action", "sudo"),
      eq("outcome", "failure"),
    ),
    threshold: 3,
    windowMs: 5 * minute,
    groupBy: ["user"],
    severity: 2,
    mitre: "T1548.003",
  },
  {
    id: "privileged-group",
    name: "User added to privileged group",
    description: "User added to sudo, wheel or admin",
    kind: "match",
    condition: all(eq("action", "group_add"), {
      field: "fields.group",
      op: "in",
      value: ["sudo", "wheel", "admin"],
    }),
    groupBy: ["user", "fields.group"],
    severity: 3,
    mitre: "T1098",
  },
  {
    id: "web-scanning",
    name: "Web scanning",
    description: "Twenty HTTP 404 responses per IP in a minute",
    kind: "threshold",
    condition: all(eq("category", "web"), eq("fields.status", 404)),
    threshold: 20,
    windowMs: minute,
    groupBy: ["src_ip"],
    severity: 2,
    mitre: "T1595",
  },
  {
    id: "web-attack",
    name: "Web attack pattern",
    description: "SQL injection, XSS, traversal or sensitive paths",
    kind: "match",
    condition: all(eq("category", "web"), {
      field: "fields.path",
      op: "regex",
      value:
        'union\\s+(?:all\\s+)?select|(?:or|and)\\s+[0-9]+\\s*=|[\x27\\"]\\s*(?:or|and)\\b|<script|javascript:|onerror\\s*=|\\.\\./|/etc/passwd|\\.env(?:[/?]|$)|wp-login',
      flags: "i",
      decode: true,
    }),
    groupBy: ["src_ip"],
    severity: 2,
    mitre: "T1190",
  },
  {
    id: "server-errors",
    name: "HTTP 5xx burst",
    description: "Ten HTTP server errors per host in a minute",
    kind: "threshold",
    condition: all(
      eq("category", "web"),
      { field: "fields.status", op: "gte", value: 500 },
      { field: "fields.status", op: "lte", value: 599 },
    ),
    threshold: 10,
    windowMs: minute,
    groupBy: ["host"],
    severity: 2,
    mitre: "T1499",
  },
];
