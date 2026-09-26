import type { Direction } from "../ui/walkIntent";

export const CONTROLLER_BUTTONS = ["a", "b", "x", "y"] as const;

export type ControllerButton = (typeof CONTROLLER_BUTTONS)[number];

export const DEFAULT_CONTROLLER_ID = "arcade";

export const CONTROLLER_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/** One server-sent event of `GET /api/controllers/:id/events` (docs/controllers.md). */
export interface ControllerState {
  /** -1 full left … 1 full right. */
  readonly x: number;
  /** -1 full down … 1 full up. */
  readonly y: number;
  readonly held: readonly Direction[];
  readonly buttons: readonly ControllerButton[];
}

export interface StreamMessage {
  readonly data: unknown;
}

/** `EventSource.readyState`: after an error it is `connecting` while the browser retries, `closed` once it gave up. */
export const STREAM_STATE = { connecting: 0, open: 1, closed: 2 } as const;

/** The part of the browser's `EventSource` the remote stick and shared pages rely on. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: "message", listener: (message: StreamMessage) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface RemoteStickOptions {
  readonly controllerId: string;
  readonly openEventSource: EventSourceFactory;
  /** Called once each time the CAT button goes down. */
  readonly onCat?: () => void;
}
