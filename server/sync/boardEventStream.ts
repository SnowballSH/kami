import type { FeedMessage, PeerId } from "../../src/sync/wire";
import type { BoardFeed } from "./boardFeed";

/** Bun.serve's default `idleTimeout` is 10 s; the keep-alive comment comes well inside that. */
export const KEEP_ALIVE_MS = 5_000;
const RECONNECT_AFTER_MS = 1_000;
const HIGH_WATER_BYTES = 64 * 1024;
/** A reader this far behind has stalled; it is dropped and catches up from its cursor on reconnect. */
export const MAX_BACKLOG_BYTES = 4 * 1024 * 1024;

const EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

const KEEP_ALIVE_COMMENT = ": keep-alive\n\n";
const reconnectField = `retry: ${RECONNECT_AFTER_MS}\n\n`;

/**
 * Numbered changes, and the `cursor` or `resync` a stream opens with, carry their `seq` as the event id,
 * so a browser that reconnects before any change arrived still sends back where it was as `Last-Event-ID`.
 */
const eventOf = (message: FeedMessage): string => {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  switch (message.type) {
    case "put":
    case "delete":
    case "clear":
    case "cursor":
    case "resync":
      return `id: ${message.seq}\n${data}`;
    case "presence":
      return data;
  }
};

export interface BoardStreamSettings {
  readonly since: number | null;
  /** The device listening; its own Alice is taken off the board when the stream ends. */
  readonly peer: PeerId | null;
  readonly keepAliveMs: number;
  readonly authorized: () => boolean;
  readonly signal: AbortSignal;
}

/** Server-Sent Events for one board: what it missed since `since`, then every change, until the client leaves. */
export const boardEventStream = (
  feed: BoardFeed,
  boardId: string,
  {
    since = null,
    peer = null,
    keepAliveMs = KEEP_ALIVE_MS,
    signal,
    authorized = () => true,
  }: Partial<BoardStreamSettings> = {},
): Response => {
  const encoder = new TextEncoder();
  let release = (): void => {};
  const body = new ReadableStream<Uint8Array>(
    {
      start: (stream) => {
        let closed = false;
        let unsubscribe = (): void => {};
        let keepAlive: ReturnType<typeof setInterval> | undefined;
        const close = (): void => {
          if (closed) return;
          closed = true;
          release();
          try {
            stream.close();
          } catch {}
        };
        const drop = (): void => {
          closed = true;
          release();
          stream.error(new Error("the event stream reader fell behind"));
        };
        release = () => {
          clearInterval(keepAlive);
          unsubscribe();
          if (peer !== null) feed.leave(boardId, peer);
          signal?.removeEventListener("abort", close);
          release = () => {};
        };
        if (signal?.aborted || !authorized()) {
          close();
          return;
        }
        const send = (text: string): void => {
          if (closed) return;
          if (!authorized()) {
            close();
            return;
          }
          try {
            stream.enqueue(encoder.encode(text));
          } catch {
            release();
            return;
          }
          if ((stream.desiredSize ?? 0) < -MAX_BACKLOG_BYTES) drop();
        };
        send(reconnectField);
        if (closed) return;
        unsubscribe = feed.subscribe(boardId, since, (message) => send(eventOf(message)));
        if (closed) {
          unsubscribe();
          return;
        }
        keepAlive = setInterval(() => send(KEEP_ALIVE_COMMENT), keepAliveMs);
        signal?.addEventListener("abort", close, { once: true });
      },
      cancel: () => release(),
    },
    new ByteLengthQueuingStrategy({ highWaterMark: HIGH_WATER_BYTES }),
  );
  return new Response(body, { headers: EVENT_STREAM_HEADERS });
};

/** The cursor a client resumes from: `?since=` or, on a browser's own reconnect, `Last-Event-ID`. */
export const sinceOf = (request: Request): number | null => {
  const url = new URL(request.url);
  const raw = url.searchParams.get("since") ?? request.headers.get("last-event-id");
  if (raw === null) return null;
  const since = Number(raw);
  return Number.isInteger(since) && since >= 0 ? since : null;
};
