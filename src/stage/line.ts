/** One WebSocket to the stage, as the source and the screen use it; tests dial a fake. */
export interface StageLine {
  send(message: string): void;
  /** Bytes queued and not yet on the wire. */
  buffered(): number;
  close(): void;
}

export interface LineHandlers {
  opened(): void;
  message(text: string): void;
  closed(): void;
}

export type DialStage = (handlers: LineHandlers) => StageLine;

export const dialBrowser =
  (url: string): DialStage =>
  (handlers) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => handlers.opened());
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") handlers.message(event.data);
    });
    socket.addEventListener("close", () => handlers.closed());
    socket.addEventListener("error", () => socket.close());
    return {
      send: (message) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
      },
      buffered: () => socket.bufferedAmount,
      close: () => socket.close(),
    };
  };

const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 15_000;
/** Each wait is stretched or shrunk by up to this share, so devices dropped together do not return together. */
const RETRY_JITTER = 0.25;

export type Schedule = (task: () => void, afterMs: number) => void;

/** A line that is dialled again, ever more patiently, whenever it drops. */
export class KeptLine {
  #line: StageLine | null = null;
  #open = false;
  #retryMs = FIRST_RETRY_MS;

  constructor(
    private readonly dial: DialStage,
    private readonly handlers: LineHandlers,
    private readonly schedule: Schedule = (task, afterMs) => void setTimeout(task, afterMs),
    private readonly chance: () => number = Math.random,
  ) {
    this.#connect();
  }

  get open(): boolean {
    return this.#open;
  }

  send(message: string): void {
    if (this.#open) this.#line?.send(message);
  }

  buffered(): number {
    return this.#line?.buffered() ?? 0;
  }

  #connect(): void {
    this.#line = this.dial({
      opened: () => {
        this.#open = true;
        this.#retryMs = FIRST_RETRY_MS;
        this.handlers.opened();
      },
      message: (text) => this.handlers.message(text),
      closed: () => {
        this.#open = false;
        this.#line = null;
        this.handlers.closed();
        const jitter = 1 + RETRY_JITTER * (2 * this.chance() - 1);
        this.schedule(() => this.#connect(), Math.round(this.#retryMs * jitter));
        this.#retryMs = Math.min(LAST_RETRY_MS, this.#retryMs * 2);
      },
    });
  }
}
