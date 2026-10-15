import index from "../web/index.html";
import { createApp } from "./api";
import { config } from "./config";
const options = config();
const app = createApp(options);
const server = Bun.serve({
  hostname: options.host,
  port: options.port,
  // SSE keepalives are 15 seconds apart; Bun defaults to a 10-second timeout.
  idleTimeout: 0,
  // The Fetch handler enforces 5 MiB while reading and returns JSON errors.
  // Bun's native limit rejects before the handler with an empty response.
  maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/events": index,
    "/alerts": index,
    "/alerts/:id": index,
    "/rules": index,
  },
  fetch: app.fetch,
});
const socket = options.syslogPort
  ? await Bun.udpSocket({
      hostname: options.host,
      port: options.syslogPort,
      socket: {
        data(_socket, data) {
          try {
            app.ingest([
              { raw: new TextDecoder().decode(data), source: "syslog" },
            ]);
          } catch (error) {
            console.error("UDP ingest failed", error);
          }
        },
      },
    })
  : null;
console.log(
  `detect-dash listening on ${server.url}, syslog ${options.syslogPort || "disabled"}`,
);
function close() {
  socket?.close();
  server.stop(true);
  app.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
