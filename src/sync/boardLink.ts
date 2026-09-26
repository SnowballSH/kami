import type { EventSourceFactory, EventSourceLike } from "../controller/types";
import { API_BASE, browserFetch, type FetchLike, JSON_HEADERS } from "../persistence/api";
import type { FeedCursor } from "../persistence/types";
import type { AliceSnapshot } from "../sim/types";
import type { Detach } from "../ui/types";
import {
  type BoardChange,
  formatCursor,
  type Ghost,
  ghostOf,
  type PeerId,
  parseFeedMessage,
} from "./wire";

/** How often a device says where its Alice is: a few times a second is plenty for a ghost. */
export const PRESENCE_INTERVAL_MS = 250;

export const boardEventsPath = (
  boardId: string,
  peer: PeerId,
  since: FeedCursor | null = null,
): string => {
  const path = `${API_BASE}/boards/${encodeURIComponent(boardId)}/events?peer=${encodeURIComponent(peer)}`;
  return since === null ? path : `${path}&since=${encodeURIComponent(formatCursor(since))}`;
};

export const presencePath = (boardId: string): string =>
  `${API_BASE}/boards/${encodeURIComponent(boardId)}/presence`;

export interface PageListener {
  /** A change someone (possibly this very device, echoed back) made to the page. */
  changed(change: BoardChange): void;
  /** Where another device's Alice is now; null when that device left. */
  seen(peer: PeerId, alice: Ghost | null): void;
  /**
   * The stream cannot say what was missed, and has stopped: load the page again and follow on from
   * the cursor that load carries.
   */
  resync(): void;
}

export interface BoardLinkOptions {
  readonly peer: PeerId;
  readonly openEventSource: EventSourceFactory;
  readonly fetch?: FetchLike;
  readonly presenceIntervalMs?: number;
}

interface Following {
  readonly boardId: string;
  readonly source: EventSourceLike;
  /** The last change handed on: anything numbered at or before it is old news. */
  cursor: FeedCursor | null;
  lastAnnouncedAtMs: number;
}

/**
 * One device's line to a shared page: it hears every change the server relays and tells the server
 * where its own Alice is. It follows on from a cursor — the one the page was loaded at — so nothing
 * between the load and the stream is lost, and hands each change on once, in order.
 */
export class BoardLink {
  readonly peer: PeerId;
  private readonly openEventSource: EventSourceFactory;
  private readonly fetch: FetchLike;
  private readonly presenceIntervalMs: number;
  private following: Following | null = null;

  constructor({
    peer,
    openEventSource,
    fetch = browserFetch,
    presenceIntervalMs = PRESENCE_INTERVAL_MS,
  }: BoardLinkOptions) {
    this.peer = peer;
    this.openEventSource = openEventSource;
    this.fetch = fetch;
    this.presenceIntervalMs = presenceIntervalMs;
  }

  get boardId(): string | null {
    return this.following?.boardId ?? null;
  }

  /** Follows the board from `since` (where its snapshot was read), or from now when there is none. */
  follow(boardId: string, listener: PageListener, since: FeedCursor | null = null): Detach {
    this.unfollow();
    const source = this.openEventSource(boardEventsPath(boardId, this.peer, since));
    const following: Following = {
      boardId,
      source,
      cursor: since,
      lastAnnouncedAtMs: Number.NEGATIVE_INFINITY,
    };
    this.following = following;
    source.addEventListener("message", ({ data }) => {
      if (this.following !== following) return;
      const message = parseFeedMessage(data);
      if (message === null) return;
      switch (message.type) {
        case "put":
        case "delete":
        case "clear":
          if (following.cursor !== null && message.seq <= following.cursor.seq) return;
          following.cursor = { boot: following.cursor?.boot ?? null, seq: message.seq };
          listener.changed(message);
          return;
        case "presence":
          if (message.peer !== this.peer) listener.seen(message.peer, message.alice);
          return;
        case "resync":
          this.unfollow();
          listener.resync();
          return;
        case "cursor":
          following.cursor ??= { boot: message.boot ?? null, seq: message.seq };
          return;
      }
    });
    return () => {
      if (this.following === following) this.unfollow();
    };
  }

  /** Tells the page where this device's Alice is, no more often than the interval. */
  announce(alice: AliceSnapshot, nowMs: number): void {
    const following = this.following;
    if (following === null || nowMs - following.lastAnnouncedAtMs < this.presenceIntervalMs) return;
    following.lastAnnouncedAtMs = nowMs;
    void this.fetch(presencePath(following.boardId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ peer: this.peer, alice: ghostOf(alice) }),
      keepalive: true,
    }).catch(() => {});
  }

  unfollow(): void {
    this.following?.source.close();
    this.following = null;
  }
}
