/**
 * Bun.serve drops a connection that has been silent for 10 s (its default `idleTimeout`), so the
 * keep-alive comment has to come well inside that.
 */
export const KEEP_ALIVE_MS = 5_000;
export const DEFAULT_MAX_BACKLOG_BYTES = 1024 * 1024;
export const STALL_MS = 30_000;
const RECONNECT_AFTER_MS = 1_000;
const BACKPRESSURE_SINCE = [1, 4, 2] as const;

/**
 * Whether this Bun only pulls a response body while the connection can take more. Older ones pull it all
 * into their own write buffer, so a reader that stops reading costs memory until `idleTimeout`.
 */
export const pacesResponseBodies = (bunVersion: string): boolean => {
  const parts = bunVersion.split(/[.-]/, 3).map(Number);
  for (const [i, least] of BACKPRESSURE_SINCE.entries()) {
    const part = parts[i] ?? 0;
    if (part !== least) return part > least;
  }
  return true;
};

const EVENT_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

const KEEP_ALIVE_COMMENT = ": keep-alive\n\n";
const RECONNECT_FIELD = `retry: ${RECONNECT_AFTER_MS}\n\n`;

export type EventStreamEndReason =
  | "closed"
  | "cancelled"
  | "unauthorized"
  | "fell-behind"
  | "stalled";

/** How a stream ended, with what its own queue measured on the way. */
export interface EventStreamEnd {
  readonly reason: EventStreamEndReason;
  /** The most bytes that ever waited in the stream's queue for the server to take them. */
  readonly peakBacklogBytes: number;
  /** Bytes the server took from the queue to write to the connection. */
  readonly deliveredBytes: number;
}

export interface EventStreamSettings {
  readonly keepAliveMs: number;
  /** Queued bytes past which a reader counts as fallen behind and is dropped. */
  readonly maxBacklogBytes: number;
  /** How long bytes may wait with the server taking none of them before the reader is dropped. */
  readonly stallMs: number;
  readonly authorized: () => boolean;
  /** The request's signal: a client that goes away without the stream being cancelled still unsubscribes. */
  readonly signal: AbortSignal | null;
  readonly now: () => number;
  readonly onEnd: (end: EventStreamEnd) => void;
}

/** Starts delivering events through `send`; returns what stops it. */
export type EventSubscription = (send: (event: string) => void) => () => void;

const DROPPED: Partial<Record<EventStreamEndReason, string>> = {
  "fell-behind": "the event stream reader fell behind",
  stalled: "the event stream reader stalled",
};

/**
 * One Server-Sent Events response. Events wait in the stream's own queue and are handed over only when
 * the server pulls, which Bun ≥ 1.4 does only while the connection can take more, so the queue is what
 * a slow reader costs. See `server/README.md` → "Slow readers".
 */
class EventStream {
  readonly #subscribe: EventSubscription;
  readonly #settings: EventStreamSettings;
  readonly #encoder = new TextEncoder();
  readonly #queue: Uint8Array[] = [];
  #controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  #backlogBytes = 0;
  #peakBacklogBytes = 0;
  #deliveredBytes = 0;
  #waitingSince = 0;
  #wake: (() => void) | null = null;
  #ended = false;
  #unsubscribe = (): void => {};
  #keepAlive: ReturnType<typeof setInterval> | undefined;

  constructor(subscribe: EventSubscription, settings: EventStreamSettings) {
    this.#subscribe = subscribe;
    this.#settings = settings;
  }

  readonly body = (): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>(
      {
        start: (controller) => this.#start(controller),
        pull: (controller) => this.#pull(controller),
        cancel: () => this.#end("cancelled"),
      },
      { highWaterMark: 0 },
    );

  #start(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.#controller = controller;
    const { signal, keepAliveMs, authorized } = this.#settings;
    if (signal?.aborted) this.#end("closed");
    else if (!authorized()) this.#end("unauthorized");
    else this.#send(RECONNECT_FIELD);
    if (this.#ended) return;
    const unsubscribe = this.#subscribe((event) => this.#send(event));
    if (this.#ended) {
      unsubscribe();
      return;
    }
    this.#unsubscribe = unsubscribe;
    this.#keepAlive = setInterval(() => this.#tick(), keepAliveMs);
    signal?.addEventListener("abort", this.#abort, { once: true });
  }

  async #pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    while (this.#queue.length === 0 && !this.#ended)
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    const chunk = this.#queue.shift();
    if (chunk === undefined) return;
    this.#backlogBytes -= chunk.byteLength;
    this.#deliveredBytes += chunk.byteLength;
    this.#waitingSince = this.#settings.now();
    controller.enqueue(chunk);
  }

  readonly #abort = (): void => this.#end("closed");

  #tick(): void {
    if (this.#stalled()) this.#end("stalled");
    else this.#send(KEEP_ALIVE_COMMENT);
  }

  #stalled(): boolean {
    return (
      this.#backlogBytes > 0 && this.#settings.now() - this.#waitingSince >= this.#settings.stallMs
    );
  }

  #send(text: string): void {
    if (this.#ended) return;
    if (!this.#settings.authorized()) {
      this.#end("unauthorized");
      return;
    }
    const chunk = this.#encoder.encode(text);
    if (this.#backlogBytes === 0) this.#waitingSince = this.#settings.now();
    this.#queue.push(chunk);
    this.#backlogBytes += chunk.byteLength;
    this.#peakBacklogBytes = Math.max(this.#peakBacklogBytes, this.#backlogBytes);
    if (this.#backlogBytes > this.#settings.maxBacklogBytes) this.#end("fell-behind");
    else this.#wakePull();
  }

  #wakePull(): void {
    this.#wake?.();
    this.#wake = null;
  }

  #end(reason: EventStreamEndReason): void {
    if (this.#ended) return;
    this.#ended = true;
    clearInterval(this.#keepAlive);
    this.#settings.signal?.removeEventListener("abort", this.#abort);
    this.#queue.length = 0;
    this.#backlogBytes = 0;
    this.#wakePull();
    this.#unsubscribe();
    this.#settings.onEnd({
      reason,
      peakBacklogBytes: this.#peakBacklogBytes,
      deliveredBytes: this.#deliveredBytes,
    });
    if (reason !== "cancelled") this.#finish(reason);
  }

  #finish(reason: EventStreamEndReason): void {
    const failure = DROPPED[reason];
    try {
      if (failure === undefined) this.#controller?.close();
      else this.#controller?.error(new Error(failure));
    } catch {}
  }
}

/** Server-Sent Events: `retry:`, then what `subscribe` sends and keep-alives, until either side leaves. */
export const eventStreamResponse = (
  subscribe: EventSubscription,
  {
    keepAliveMs = KEEP_ALIVE_MS,
    maxBacklogBytes = DEFAULT_MAX_BACKLOG_BYTES,
    stallMs = STALL_MS,
    authorized = () => true,
    signal = null,
    now = Date.now,
    onEnd = () => {},
  }: Partial<EventStreamSettings> = {},
): Response => {
  const stream = new EventStream(subscribe, {
    keepAliveMs,
    maxBacklogBytes,
    stallMs,
    authorized,
    signal,
    now,
    onEnd,
  });
  return new Response(stream.body(), { headers: EVENT_STREAM_HEADERS });
};
