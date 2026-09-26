import type { ControllerState, EventSourceLike, StreamMessage } from "../types";

type StreamEventType = "message" | "error";

type StreamListener = (message: StreamMessage) => void;

export class FakeEventSource implements EventSourceLike {
  static readonly opened: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
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

  close(): void {
    this.closed = true;
  }

  send(data: unknown): void {
    if (this.listeners.message.length === 0) this.unheard.push(data);
    else this.dispatch("message", data);
  }

  sendState(state: Partial<ControllerState>): void {
    this.send(JSON.stringify({ x: 0, y: 0, held: [], buttons: [], ...state }));
  }

  fail(): void {
    this.dispatch("error", undefined);
  }

  private dispatch(type: StreamEventType, data: unknown): void {
    for (const listener of this.listeners[type]) listener({ data });
  }
}
