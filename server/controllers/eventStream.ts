import type { ControllerHub, ControllerState } from "./types";

/**
 * Bun.serve drops a connection that has been silent for 10 s (its default `idleTimeout`), so the
 * keep-alive comment has to come well inside that.
 */
export const KEEP_ALIVE_MS = 5_000;
const RECONNECT_AFTER_MS = 1_000;

const EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

const KEEP_ALIVE_COMMENT = ": keep-alive\n\n";
const reconnectField = `retry: ${RECONNECT_AFTER_MS}\n\n`;
const eventOf = (state: ControllerState): string => `data: ${JSON.stringify(state)}\n\n`;

export interface EventStreamSettings {
  readonly keepAliveMs: number;
  readonly authorized: () => boolean;
  /** The request's signal: a client that goes away without the stream being cancelled still unsubscribes. */
  readonly signal: AbortSignal;
}

/** Server-Sent Events for one controller: its state now, then every change, until the client leaves. */
export const controllerEventStream = (
  hub: ControllerHub,
  id: string,
  {
    keepAliveMs = KEEP_ALIVE_MS,
    signal,
    authorized = () => true,
  }: Partial<EventStreamSettings> = {},
): Response => {
  const encoder = new TextEncoder();
  let release = (): void => {};
  const body = new ReadableStream<Uint8Array>({
    start: (stream) => {
      let unsubscribe = (): void => {};
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      const close = (): void => {
        release();
        try {
          stream.close();
        } catch {}
      };
      release = () => {
        clearInterval(keepAlive);
        unsubscribe();
        signal?.removeEventListener("abort", close);
        release = () => {};
      };
      if (signal?.aborted || !authorized()) {
        close();
        return;
      }
      const send = (text: string): void => {
        if (!authorized()) {
          close();
          return;
        }
        try {
          stream.enqueue(encoder.encode(text));
        } catch {
          release();
        }
      };
      send(reconnectField);
      unsubscribe = hub.subscribe(id, (state) => send(eventOf(state)));
      keepAlive = setInterval(() => send(KEEP_ALIVE_COMMENT), keepAliveMs);
      signal?.addEventListener("abort", close, { once: true });
    },
    cancel: () => release(),
  });
  return new Response(body, { headers: EVENT_STREAM_HEADERS });
};
