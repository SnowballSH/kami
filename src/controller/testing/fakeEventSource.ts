import {
  type ControllerState,
  type EventSourceLike,
  STREAM_STATE,
  type StreamMessage,
} from "../types";

type StreamEventType = "message" | "error";

type StreamListener = (message: StreamMessage) => void;

export class FakeEventSource implements EventSourceLike {
  static readonly opened: FakeEventSource[] = [];

  readonly url: string;
  readyState: number = STREAM_STATE.open;
  private readonly listeners: Readonly<Record<StreamEventType, StreamListener[]>> = {
    message: [],
    error: [],
  };
  /** Like a real stream, nothing sent before anyone listens is lost: it waits for the first listener. */
  private readonly unheard: unknown[] = [];

  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.opened.at(-1);
    if (source === undefined) throw new Error("No event source was opened");
    return source;
  }

  addEventListener(type: "message", listener: StreamListener): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: StreamEventType, listener: StreamListener): void {
    this.listeners[type].push(listener);
    if (type === "message") for (const data of this.unheard.splice(0)) listener({ data });
  }

  get closed(): boolean {
    return this.readyState === STREAM_STATE.closed;
  }

  close(): void {
    this.readyState = STREAM_STATE.closed;
  }

  send(data: unknown): void {
    if (this.listeners.message.length === 0) this.unheard.push(data);
    else this.dispatch("message", data);
  }

  sendState(state: Partial<ControllerState>): void {
    this.send(JSON.stringify({ x: 0, y: 0, held: [], buttons: [], ...state }));
  }

  /** A dropped connection the browser will retry by itself. */
  fail(): void {
    this.readyState = STREAM_STATE.connecting;
    this.dispatch("error", undefined);
  }

  /** An answer the browser will not retry (a 502, a 401): the stream is closed for good. */
  die(): void {
    this.readyState = STREAM_STATE.closed;
    this.dispatch("error", undefined);
  }

  private dispatch(type: StreamEventType, data: unknown): void {
    for (const listener of this.listeners[type]) listener({ data });
  }
}
