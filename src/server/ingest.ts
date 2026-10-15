import { insertEvents, type DB } from "./db";
import type { Bus } from "./bus";
import type { DetectionEngine } from "./detection/engine";
import { normalize } from "./parsers/json";
import { boundedRaw, parseLine } from "./parsers";
import type { NormalizedEventInput } from "./schema";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readBody(request: Request): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > 5 * 1024 * 1024)
    throw new HttpError(413, "body exceeds 5 MB");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError(413, "body exceeds 5 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
export function ingestItems(
  items: unknown[],
  db: DB,
  engine: DetectionEngine,
  bus: Bus,
  maxFutureSkewMs = 300000,
) {
  if (items.length > 5000) throw new HttpError(413, "maximum 5000 events");
  const events: NormalizedEventInput[] = [];
  const errors: { index: number; error: string }[] = [];
  let rejected = 0;
  items.forEach((item, index) => {
    try {
      const checked = normalize(item);
      const v = item as Record<string, unknown>;
      if (
        typeof v.raw === "string" &&
        v.category === undefined &&
        v.action === undefined &&
        v.message === undefined
      ) {
        events.push(
          parseLine(v.raw, {
            now: Date.now(),
            ts: v.ts === undefined ? undefined : checked.ts,
            source: v.source as string | undefined,
            host: v.host as string | undefined,
          }),
        );
      } else {
        const bounded = boundedRaw(checked.raw);
        checked.raw = bounded.raw;
        if (bounded.truncated) checked.fields = { ...checked.fields, truncated: true };
        events.push(checked);
      }
    } catch (error) {
      rejected++;
      if (errors.length < 50)
        errors.push({
          index,
          error: error instanceof Error ? error.message : "invalid event",
        });
    }
  });
  const now = Date.now();
  for (const event of events) {

    if (event.ts > now + maxFutureSkewMs) event.fields.future_ts = true;
    else delete event.fields.future_ts;
  }
  const inserted = insertEvents(db, events);
  engine.evaluate(inserted.filter(event => !event.fields.future_ts));
  if (inserted.length) bus.events(inserted);
  return { accepted: inserted.length, rejected, errors };
}
export async function ingestRequest(
  request: Request,
  db: DB,
  engine: DetectionEngine,
  bus: Bus,
  maxFutureSkewMs = 300000,
) {
  const body = await readBody(request);
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() ===
    "application/x-ndjson"
  ) {
    const lines = body.split(/\r?\n/).filter((x) => x.trim());
    // A malformed line remains an individual invalid item.
    return ingestItems(
      lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }),
      db,
      engine,
      bus,
      maxFutureSkewMs,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  return ingestItems(Array.isArray(value) ? value : [value], db, engine, bus, maxFutureSkewMs);
}
