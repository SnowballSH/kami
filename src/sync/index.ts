import { BoardLink } from "./boardLink";
import { mintPeerId } from "./peer";

export type { BoardLinkOptions, PageListener } from "./boardLink";
export {
  BoardLink,
  boardEventsPath,
  PRESENCE_INTERVAL_MS,
  presencePath,
  RECONNECT_BACKOFF_MS,
} from "./boardLink";
export { EditTrackingStore } from "./editTrackingStore";
export { LocalEdits } from "./localEdits";
export { mintPeerId } from "./peer";
export {
  type BoardChange,
  type BoardEdit,
  type FeedMessage,
  type Ghost,
  PEER_ID_PATTERN,
  type PeerId,
  parseFeedMessage,
} from "./wire";

/** The line to shared pages; null in a browser without `EventSource`. */
export const createBoardLink = (): BoardLink | null =>
  typeof EventSource === "undefined"
    ? null
    : new BoardLink({ peer: mintPeerId(), openEventSource: (url) => new EventSource(url) });
