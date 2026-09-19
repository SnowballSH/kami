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
  }

  close(): void {
    this.closed = true;
  }

  send(data: unknown): void {
    this.dispatch("message", data);
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
