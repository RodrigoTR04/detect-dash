import type { Event } from "./schema";
export class Bus {
  private subscribers = new Set<(data: string) => void>();
  private cleanups = new Set<() => void>();
  private pending: Event[] = [];
  private count = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private emit(type: string, data: unknown) {
    for (const send of this.subscribers)
      send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  alert = (alert: unknown) => this.emit("alert", alert);
  events(events: Event[]) {
    this.count += events.length;
    this.pending = [...events.slice(-20).reverse(), ...this.pending].slice(
      0,
      20,
    );
    this.timer ??= setTimeout(() => {
      this.emit("events", { count: this.count, latest: this.pending });
      this.pending = [];
      this.count = 0;
      this.timer = undefined;
    }, 500);
  }
  stream(signal: AbortSignal) {
    if (this.subscribers.size >= 50) return Response.json({ error: "SSE subscriber limit reached" }, { status: 503 });
    const encoder = new TextEncoder();
    let cleanup = (_close = true) => {};
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let done = false;
        const send = (s: string) => {
          if (done) return;
          const bytes = encoder.encode(s);
          if ((controller.desiredSize ?? 0) < Math.max(bytes.length, 1049)) {
            cleanup(false);
            controller.error(new Error("SSE client fell behind"));
            return;
          }
          controller.enqueue(bytes);
        };
        const keepalive = setInterval(() => send(": keepalive\n\n"), 15000);
        const onAbort = () => cleanup();
        cleanup = (close = true) => {
          if (done) return;
          done = true;
          clearInterval(keepalive);
          this.subscribers.delete(send);
          this.cleanups.delete(cleanup);
          signal.removeEventListener("abort", onAbort);
          if (close) controller.close();
        };
        this.cleanups.add(cleanup);
        this.subscribers.add(send);
        signal.addEventListener("abort", onAbort, { once: true });
        send(": connected\n\n");
        if (signal.aborted) cleanup();
      },
      cancel: () => cleanup(false),
    }, { highWaterMark: 1024 * 1024, size: chunk => Math.max(chunk?.byteLength ?? 0, 1049) });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  close() {
    clearTimeout(this.timer);
    for (const cleanup of this.cleanups) cleanup();
    this.pending = [];
    this.count = 0;
  }
}
