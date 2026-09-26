import {
  type FeedCursor,
  type FeedMessage,
  formatCursor,
  type PeerId,
  parseCursor,
} from "../../src/sync/wire";
import { type EventStreamSettings, eventStreamResponse } from "../http/eventStream";
import { type BoardFeed, KEPT_BYTES } from "./boardFeed";

/**
 * A reader this far behind has stalled; it is dropped and catches up from its cursor on reconnect. Twice
 * the most a catch-up replays, so that catch-up (with its events' framing) always fits.
 */
export const MAX_BACKLOG_BYTES = 2 * KEPT_BYTES;

/**
 * Numbered changes, and the `cursor` or `resync` a stream opens with, carry `<boot>:<seq>` as the event
 * id, so a browser that reconnects — even before any change arrived — sends back where it was, and in
 * which life of the server, as `Last-Event-ID`.
 */
const eventOf = (message: FeedMessage, boot: string): string => {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  switch (message.type) {
    case "put":
    case "delete":
    case "clear":
    case "cursor":
    case "resync":
      return `id: ${formatCursor({ boot, seq: message.seq })}\n${data}`;
    case "presence":
      return data;
  }
};

export interface BoardStreamSettings extends EventStreamSettings {
  readonly since: FeedCursor | null;
  /** The device listening; its own Alice is taken off the board when the stream ends. */
  readonly peer: PeerId | null;
}

/** Server-Sent Events for one board: what it missed since `since`, then every change, until the client leaves. */
export const boardEventStream = (
  feed: BoardFeed,
  boardId: string,
  { since = null, peer = null, ...stream }: Partial<BoardStreamSettings> = {},
): Response =>
  eventStreamResponse(
    (send) => {
      const unsubscribe = feed.subscribe(boardId, since, (message) =>
        send(eventOf(message, feed.boot)),
      );
      return () => {
        unsubscribe();
        if (peer !== null) feed.leave(boardId, peer);
      };
    },
    { maxBacklogBytes: MAX_BACKLOG_BYTES, ...stream },
  );

/**
 * The cursor a client resumes from: on a browser's own reconnect its `Last-Event-ID`, which is always
 * newer than the `?since=` the stream was first opened with; otherwise that `since`.
 */
export const sinceOf = (request: Request): FeedCursor | null => {
  const raw =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("since");
  return raw === null ? null : parseCursor(raw);
};
