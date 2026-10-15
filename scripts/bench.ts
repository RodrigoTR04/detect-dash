import { createApp } from "../src/server/api";
import { insertEvents } from "../src/server/db";
import { normalize } from "../src/server/parsers/json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "detect-bench-"));
const app = createApp({ dbPath: join(dir, "bench.db") });
const to = Math.floor(Date.now() / 60000) * 60000 - 1,
  from = to + 1 - 86400000;
try {
  const start = performance.now();
  for (let offset = 0; offset < 1700000; offset += 5000)
    insertEvents(
      app.db,
      Array.from({ length: Math.min(5000, 1700000 - offset) }, (_, j) => {
        const i = offset + j;
        return normalize({
          ts: from + Math.floor((i * 86400000) / 1700000),
          source: ["sshd", "nginx", "sudo", "app"][i % 4],
          category: ["auth", "web", "process", "system"][i % 4],
          outcome: i % 13 === 0 ? "failure" : "success",
          severity: i % 5,
          src_ip: `10.0.0.${(i % 200) + 1}`,
          user: `user${i % 80}`,
          message: i % 37 === 0 ? "Request timed out" : "Request completed",
          fields: { status: i % 13 === 0 ? 500 : 200 },
        });
      }),
    );
  console.log(
    `Seeded 1,700,000 events in ${((performance.now() - start) / 1000).toFixed(2)} s`,
  );
  for (const path of [
    "/api/stats",
    "/api/events",
    "/api/events?q=timed%20out",
    "/api/events?src_ip=10.0.0.42",
  ]) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const response = await app.fetch(
        new Request(
          `http://local${path}${path.includes("?") ? "&" : "?"}from=${from}&to=${to}`,
        ),
      );
      await response.json();
      if (response.status !== 200) throw Error(`HTTP ${response.status}`);
      times.push(performance.now() - t);
    }
    console.log(
      `${path}: first=${times[0]!.toFixed(2)} ms, median=${[...times].sort((a, b) => a - b)[2]!.toFixed(2)} ms`,
    );
  }
} finally {
  app.close();
  rmSync(dir, { recursive: true, force: true });
}
