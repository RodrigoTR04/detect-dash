export interface SimEvent {
  ts: number;
  raw?: string;
  source: string;
  host: string;
  [key: string]: unknown;
}
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
const pad = (n: number) => String(n).padStart(2, "0");
export class Traffic {
  private rng: () => number;
  private pending: SimEvent[] = [];
  private nextAttack: number;
  private serial = 0;
  private typoAt = new Map<string, number>();
  constructor(
    seed: number,
    start: number,
    private interval = 45,
  ) {
    this.rng = random(seed);
    this.nextAttack = start + this.delay();
  }
  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)]!;
  }
  private delay() {
    return -Math.log(1 - this.rng()) * this.interval * 1000;
  }
  private raw(
    line: string,
    ts: number,
    source: string,
    host = "auth-01",
  ): SimEvent {
    ts = Math.floor(ts);
    if (
      ["sshd", "sudo", "useradd", "usermod"].includes(source) &&
      this.rng() < 0.3
    ) {
      const d = new Date(ts);
      line = `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${host} ${source}[1234]: ${line}`;
    }
    return { raw: line, ts, source, host };
  }
  access(
    ip: string,
    path: string,
    status: number,
    ts: number,
    ua = "Mozilla/5.0",
    host = "web-01",
  ): SimEvent {
    const d = new Date(ts);
    const stamp = `${pad(d.getUTCDate())}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
    const method = this.pick(["GET", "GET", "GET", "POST", "HEAD"]);
    return this.raw(
      `${ip} - - [${stamp}] "${method} ${path} HTTP/1.1" ${status} ${Math.floor(this.rng() * 12000)} "-" "${ua}"`,
      ts,
      "nginx",
      host,
    );
  }
  benign(ts: number): SimEvent {
    const x = this.rng();
    const user = this.pick([
      "alice",
      "bob",
      "carol",
      "dave",
      "erin",
      "frank",
      "grace",
      "heidi",
    ]);
    const ip = `10.${1 + Math.floor(this.rng() * 3)}.0.${1 + Math.floor(this.rng() * 80)}`;
    if (x < 0.001)
      return this.raw(
        `new user: name=svc_export_${this.serial++}, UID=1200, GID=1200, home=/srv/export`,
        ts,
        "useradd",
        "app-01",
      );
    if (x < 0.25) {
      // Isolated typo per identity/address, with a success two seconds later.
      const key = ip;
      if (
        this.rng() < 0.025 &&
        ts - (this.typoAt.get(key) ?? -Infinity) > 1200000
      ) {
        this.typoAt.set(key, ts);
        this.pending.push(
          this.raw(
            `Accepted password for ${user} from ${ip} port 50000 ssh2`,
            ts + 2000,
            "sshd",
          ),
        );
        return this.raw(
          `Failed password for ${user} from ${ip} port 50000 ssh2`,
          ts,
          "sshd",
        );
      }
      return this.raw(
        this.rng() < 0.25
          ? `Disconnected from user ${user} ${ip} port 50000`
          : `Accepted ${this.pick(["publickey", "publickey", "password"])} for ${user} from ${ip} port 50000 ssh2`,
        ts,
        "sshd",
      );
    }
    if (x < 0.75) {
      const status = this.pick([
        200,
        200,
        200,
        200,
        200,
        200,
        304,
        304,
        301,
        404,
        ...(this.rng() < 0.01 ? [500] : []),
      ]);
      return this.access(
        `192.0.2.${1 + Math.floor(this.rng() * 30)}`,
        this.pick([
          "/",
          "/api/catalog",
          "/products/42",
          "/assets/app.js",
          "/health",
          "/login",
          "/api/orders",
          "/favicon.ico",
        ]),
        status,
        ts,
        this.pick([
          "Mozilla/5.0 Firefox/131",
          "Mozilla/5.0 Chrome/130",
          "curl/8.10",
          "Mobile Safari/18",
        ]),
      );
    }
    if (x < 0.85)
      return this.raw(
        `${this.pick(["alice", "carol", "grace"])} : TTY=pts/0 ; PWD=/srv/app ; USER=root ; COMMAND=${this.pick(["/usr/bin/systemctl status nginx", "/usr/bin/journalctl -n 50", "/usr/bin/apt update", "/usr/bin/du -sh /var/log"])}`,
        ts,
        "sudo",
        "app-01",
      );
    const failure = this.rng() < 0.03;
    return {
      ts: Math.floor(ts),
      source: "app",
      host: this.pick(["app-01", "app-02", "worker-01"]),
      category: "system",
      action: this.pick([
        "job_complete",
        "payment",
        "cache_refresh",
        "export",
        "session_create",
      ]),
      outcome: failure ? "failure" : "success",
      severity: failure ? 1 : 0,
      message: failure ? "Upstream request timed out" : "Request completed",
      fields: { duration_ms: Math.floor(this.rng() * 800) },
    };
  }
  scenario(ts: number, kind = Math.floor(this.rng() * 8)): SimEvent[] {
    const ip = `${this.pick(["203.0.113", "198.51.100"])}.${1 + Math.floor(this.rng() * 254)}`;
    const id = this.serial++;
    const result: SimEvent[] = [];
    if (kind <= 2) {
      const n = kind === 2 ? 12 : 18 + Math.floor(this.rng() * 8);
      let t = ts;
      for (let i = 0; i < n; i++) {
        const user = kind === 2 ? `spray${i}` : "root";
        if (kind === 2)
          result.push(
            this.raw(`Invalid user ${user} from ${ip} port 42000`, t, "sshd"),
          );
        result.push(
          this.raw(
            `Failed password for ${kind === 2 ? "invalid user " : ""}${user} from ${ip} port 42000 ssh2`,
            t + 10,
            "sshd",
          ),
        );
        t += 1000 + this.rng() * 2000;
      }
      if (kind === 1)
        result.push(
          this.raw(
            `Accepted password for root from ${ip} port 42000 ssh2`,
            t + 1000,
            "sshd",
          ),
        );
    } else if (kind === 3) {
      const n = 30 + Math.floor(this.rng() * 31);
      for (let i = 0; i < n; i++)
        result.push(
          this.access(
            ip,
            `/missing-${id}-${i}`,
            404,
            ts + (i * 20000) / n,
            "masscan/1.3",
          ),
        );
    } else if (kind === 4) {
      for (const [i, path] of [
        "/search?q=%27%20OR%201=1",
        "/?q=%3Cscript%3Ealert(1)",
        "/../../etc/passwd",
      ].entries())
        result.push(this.access(ip, path, 403, ts + i * 2500, "sqlmap/1.8"));
    } else if (kind === 5)
      result.push(
        this.raw(
          `add 'contractor${id}' to group 'sudo'`,
          ts,
          "usermod",
          "app-01",
        ),
      );
    else if (kind === 6) {
      for (let i = 0; i < 4; i++) {
        const user = `operator${id}`;
        result.push(
          this.raw(
            `pam_unix(sudo:auth): authentication failure; user=${user}`,
            ts + i * 8000,
            "sudo",
            "app-01",
          ),
        );
        result.push(
          this.raw(
            `${user} : 3 incorrect password attempts ; TTY=pts/0 ; PWD=/home/${user} ; USER=root ; COMMAND=/bin/bash`,
            ts + i * 8000 + 4000,
            "sudo",
            "app-01",
          ),
        );
      }
    } else {
      const host = this.pick(["web-01", "web-02"]);
      for (let i = 0; i < 35; i++)
        result.push(
          this.access(
            ip,
            "/api/orders",
            503,
            ts + i * 700,
            "Mozilla/5.0",
            host,
          ),
        );
    }
    return result;
  }
  tick(ts: number, count: number): SimEvent[] {
    while (this.nextAttack <= ts) {
      this.pending.push(...this.scenario(this.nextAttack));
      this.nextAttack += this.delay();
    }
    const result = Array.from({ length: count }, () => this.benign(ts));
    const future: SimEvent[] = [];
    for (const e of this.pending) (e.ts <= ts ? result : future).push(e);
    this.pending = future;
    return result.sort((a, b) => a.ts - b.ts);
  }
}
if (import.meta.main) {
  const options = {
    url: "http://127.0.0.1:8080",
    rate: 20,
    duration: Infinity,
    backfill: 0,
    seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    "attack-interval": 45,
  };
  for (let i = 2; i < Bun.argv.length; i += 2) {
    const key = Bun.argv[i]?.replace(/^--/, "") as keyof typeof options;
    const value = Bun.argv[i + 1];
    if (!(key in options) || value === undefined)
      throw Error(
        "Usage: --url URL --rate N --duration SECONDS --backfill HOURS --seed INTEGER --attack-interval SECONDS",
      );
    if (key === "url") options.url = value;
    else {
      const n = Number(value);
      if (
        !Number.isFinite(n) ||
        n < 0 ||
        (["rate", "attack-interval"].includes(key) && n === 0) ||
        (key === "seed" && !Number.isInteger(n))
      )
        throw Error(`Invalid ${key}`);
      options[key] = n;
    }
  }
  console.log(`Seed: ${options.seed}`);
  let accepted = 0;
  async function post(items: SimEvent[]) {
    for (let i = 0; i < items.length; i += 1000) {
      const response = await fetch(new URL("/api/ingest", options.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items.slice(i, i + 1000)),
      });
      if (!response.ok)
        throw Error(`Ingest ${response.status}: ${await response.text()}`);
      const result = (await response.json()) as {
        accepted: number;
        rejected: number;
      };
      if (result.rejected) throw Error(`Rejected ${result.rejected} events`);
      accepted += result.accepted;
    }
  }
  const start = Date.now();
  const history = start - options.backfill * 3600000;
  const traffic = new Traffic(
    options.seed,
    history,
    options["attack-interval"],
  );
  let budget = 0;
  let batch: SimEvent[] = [];
  for (let ts = history; ts < start; ts += 1000) {
    budget += options.rate;
    const count = Math.floor(budget);
    budget -= count;
    batch.push(...traffic.tick(ts, count));
    if (batch.length >= 1000) {
      await post(batch);
      batch = [];
    }
  }
  await post(batch);
  console.log(`Backfilled ${accepted} events`);
  const liveStart = Date.now();
  let last = liveStart;
  while (Date.now() - liveStart < options.duration * 1000) {
    const now = Date.now();
    budget += (options.rate * (now - last)) / 1000;
    last = now;
    const count = Math.floor(budget);
    budget -= count;
    await post(traffic.tick(now, count));
    await Bun.sleep(
      Math.min(
        1000,
        Math.max(0, options.duration * 1000 - (Date.now() - liveStart)),
      ),
    );
  }
  console.log(`Posted ${accepted} events`);
}
