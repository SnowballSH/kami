import { type EventSourceFactory, type EventSourceLike, STREAM_STATE } from "../controller/types";
import { API_BASE, browserFetch, type FetchLike, JSON_HEADERS } from "../persistence/api";
import type { FeedCursor } from "../persistence/types";
import type { AliceSnapshot } from "../sim/types";
import type { Detach } from "../ui/types";
import { LocalEdits } from "./localEdits";
import {
  type BoardChange,
  type BoardEdit,
  type FeedMessage,
  formatCursor,
  type Ghost,
  ghostOf,
  type PeerId,
  parseFeedMessage,
} from "./wire";

/** How often a device says where its Alice is: a few times a second is plenty for a ghost. */
export const PRESENCE_INTERVAL_MS = 250;

/** How long to wait before following a stream the server closed for good: doubling, up to the cap. */
export const RECONNECT_BACKOFF_MS = { first: 1_000, max: 30_000 } as const;

export type Schedule = (run: () => void, ms: number) => Detach;

const browserSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

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
  /** A change another device made to the page; this device's own come back only as older news is passed over. */
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
  readonly schedule?: Schedule;
}

interface Following {
  readonly boardId: string;
  readonly listener: PageListener;
  source: EventSourceLike;
  /** The last change handed on: anything numbered at or before it is old news. */
  cursor: FeedCursor | null;
  /** This device's writes since it followed, until the server echoes them. */
  readonly edits: LocalEdits;
  retry: Detach | null;
  lastAnnouncedAtMs: number;
}

/**
 * One device's line to a shared page: it hears every change the server relays and tells the server
 * where its own Alice is. It follows on from a cursor — the one the page was loaded at — so nothing
 * between the load and the stream is lost, and hands each change on once, in order. A stream the
 * browser gave up on (an error status closes an `EventSource` for good) is followed again from the
 * last change, after a growing wait. The echoes of this device's own writes, and anything older
 * about the same entities that arrives before them, are passed over (`LocalEdits`).
 */
export class BoardLink {
  readonly peer: PeerId;
  private readonly openEventSource: EventSourceFactory;
  private readonly fetch: FetchLike;
  private readonly presenceIntervalMs: number;
  private readonly schedule: Schedule;
  private following: Following | null = null;
  /** Streams closed in a row without a word heard on any of them. */
  private failures = 0;

  constructor({
    peer,
    openEventSource,
    fetch = browserFetch,
    presenceIntervalMs = PRESENCE_INTERVAL_MS,
    schedule = browserSchedule,
  }: BoardLinkOptions) {
    this.peer = peer;
    this.openEventSource = openEventSource;
    this.fetch = fetch;
    this.presenceIntervalMs = presenceIntervalMs;
    this.schedule = schedule;
  }

  get boardId(): string | null {
    return this.following?.boardId ?? null;
  }

  /** Follows the board from `since` (where its snapshot was read), or from now when there is none. */
  follow(boardId: string, listener: PageListener, since: FeedCursor | null = null): Detach {
    if (this.following?.boardId !== boardId) this.failures = 0;
    this.unfollow();
    const following: Following = {
      boardId,
      listener,
      source: this.openEventSource(boardEventsPath(boardId, this.peer, since)),
      cursor: since,
      edits: new LocalEdits(),
      retry: null,
      lastAnnouncedAtMs: Number.NEGATIVE_INFINITY,
    };
    this.following = following;
    this.listen(following);
    return () => {
      if (this.following === following) this.unfollow();
    };
  }

  /** Notes a write this device is about to make to the page it follows, so its echo is known. */
  wrote(boardId: string, edit: BoardEdit): void {
    if (this.following?.boardId === boardId) this.following.edits.wrote(edit);
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
    const following = this.following;
    this.following = null;
    following?.retry?.();
    following?.source.close();
  }

  private listen(following: Following): void {
    const { source } = following;
    source.addEventListener("message", ({ data }) => {
      if (this.following !== following || following.source !== source) return;
      this.failures = 0;
      const message = parseFeedMessage(data);
      if (message !== null) this.hear(following, message);
    });
    source.addEventListener("error", () => {
      if (this.following !== following || following.source !== source) return;
      if (source.readyState === STREAM_STATE.closed) this.reconnectLater(following);
    });
  }

  private hear(following: Following, message: FeedMessage): void {
    switch (message.type) {
      case "put":
      case "delete":
      case "clear":
        if (following.cursor !== null && message.seq <= following.cursor.seq) return;
        following.cursor = { boot: following.cursor?.boot ?? null, seq: message.seq };
        if (following.edits.admits(message)) following.listener.changed(message);
        return;
      case "presence":
        if (message.peer !== this.peer) following.listener.seen(message.peer, message.alice);
        return;
      case "resync":
        this.unfollow();
        following.listener.resync();
        return;
      case "cursor":
        following.cursor ??= { boot: message.boot ?? null, seq: message.seq };
        return;
    }
  }

  /**
   * Follows again from the last change once the wait is over. Without a cursor there is nothing to
   * resume from, so the page is reloaded instead.
   */
  private reconnectLater(following: Following): void {
    const waitMs = Math.min(
      RECONNECT_BACKOFF_MS.first * 2 ** this.failures,
      RECONNECT_BACKOFF_MS.max,
    );
    this.failures += 1;
    following.retry = this.schedule(() => {
      following.retry = null;
      if (this.following !== following) return;
      if (following.cursor === null) {
        this.unfollow();
        following.listener.resync();
        return;
      }
      following.source = this.openEventSource(
        boardEventsPath(following.boardId, this.peer, following.cursor),
      );
      this.listen(following);
    }, waitMs);
  }
}
