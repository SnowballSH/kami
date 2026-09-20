import type { EventSourceFactory, EventSourceLike } from "../controller/types";
import { API_BASE, browserFetch, type FetchLike, JSON_HEADERS } from "../persistence/api";
import type { AliceSnapshot } from "../sim/types";
import type { Detach } from "../ui/types";
import { type BoardChange, type Ghost, type PeerId, parseFeedMessage } from "./wire";

/** How often a device says where its Alice is: a few times a second is plenty for a ghost. */
export const PRESENCE_INTERVAL_MS = 250;

export const boardEventsPath = (boardId: string, peer: PeerId): string =>
  `${API_BASE}/boards/${encodeURIComponent(boardId)}/events?peer=${encodeURIComponent(peer)}`;

export const presencePath = (boardId: string): string =>
  `${API_BASE}/boards/${encodeURIComponent(boardId)}/presence`;

export interface PageListener {
  /** A change someone (possibly this very device, echoed back) made to the page. */
  changed(change: BoardChange): void;
  /** Where another device's Alice is now; null when that device left. */
  seen(peer: PeerId, alice: Ghost | null): void;
  /** The stream cannot say what was missed: load the page again. */
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
  lastAnnouncedAtMs: number;
}

/**
 * One device's line to a shared page: it hears every change the server relays and tells the server
 * where its own Alice is. Echoes of this device's own changes come back too; applying a change is
 * idempotent on the game's side, so that costs nothing.
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

  follow(boardId: string, listener: PageListener): Detach {
    this.unfollow();
    const source = this.openEventSource(boardEventsPath(boardId, this.peer));
    const following: Following = { boardId, source, lastAnnouncedAtMs: Number.NEGATIVE_INFINITY };
    this.following = following;
    source.addEventListener("message", ({ data }) => {
      if (this.following !== following) return;
      const message = parseFeedMessage(data);
      if (message === null) return;
      switch (message.type) {
        case "put":
        case "delete":
        case "clear":
          listener.changed(message);
          return;
        case "presence":
          if (message.peer !== this.peer) listener.seen(message.peer, message.alice);
          return;
        case "resync":
          listener.resync();
          return;
        case "cursor":
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
      body: JSON.stringify({ peer: this.peer, alice }),
      keepalive: true,
    }).catch(() => {});
  }

  unfollow(): void {
    this.following?.source.close();
    this.following = null;
  }
}
