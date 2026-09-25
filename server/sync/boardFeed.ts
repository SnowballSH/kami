import type { BoardChange, BoardEdit, FeedMessage, Ghost, PeerId } from "../../src/sync/wire";

export type Publish = (message: FeedMessage) => void;

export type Unsubscribe = () => void;

/** How many changes a board keeps for clients that reconnect with a `since` cursor. */
export const KEPT_CHANGES = 2_000;

/**
 * A device announces its Alice several times a second. One that has been silent this long has gone,
 * whether or not its event stream ever told us: an announcement can arrive after the stream closed,
 * and nothing else would ever withdraw that ghost.
 */
export const PRESENCE_GONE_AFTER_MS = 5_000;

interface Page {
  seq: number;
  readonly log: BoardChange[];
  readonly listeners: Set<Publish>;
  readonly peers: Map<PeerId, { readonly alice: Ghost; readonly heardAtMs: number }>;
}

/**
 * What happened on each board since the server started, numbered, and who is on it right now: the
 * live side of the board repository. In memory on purpose — the repository remembers, this relays.
 */
export class BoardFeed {
  readonly #pages = new Map<string, Page>();

  constructor(private readonly now: () => number = Date.now) {}

  record(boardId: string, edit: BoardEdit): BoardChange {
    const page = this.#page(boardId);
    page.seq += 1;
    const sequenced: BoardChange = { ...edit, seq: page.seq };
    page.log.push(sequenced);
    if (page.log.length > KEPT_CHANGES) page.log.splice(0, page.log.length - KEPT_CHANGES);
    this.#tell(page, sequenced);
    return sequenced;
  }

  announce(boardId: string, peer: PeerId, alice: Ghost): void {
    const page = this.#page(boardId);
    page.peers.set(peer, { alice, heardAtMs: this.now() });
    this.#tell(page, { type: "presence", peer, alice });
    this.#forgetTheSilent(page);
  }

  leave(boardId: string, peer: PeerId): void {
    const page = this.#page(boardId);
    if (!page.peers.delete(peer)) return;
    this.#tell(page, { type: "presence", peer, alice: null });
  }

  peers(boardId: string): readonly PeerId[] {
    const page = this.#page(boardId);
    this.#forgetTheSilent(page);
    return [...page.peers.keys()];
  }

  /**
   * Catches the listener up, then keeps it posted. With no `since` it hears where the log stands
   * (`cursor`) and the board is expected to be loaded afresh; with one, every change after it — or
   * `resync` when that is further back than the log reaches, or from before a restart.
   */
  subscribe(boardId: string, since: number | null, listener: Publish): Unsubscribe {
    const page = this.#page(boardId);
    if (since === null) listener({ type: "cursor", seq: page.seq });
    else if (since > page.seq || (since < page.seq && !this.#reaches(page, since))) {
      listener({ type: "resync", seq: page.seq });
    } else for (const change of page.log) if (change.seq > since) listener(change);
    this.#forgetTheSilent(page);
    for (const [peer, { alice }] of page.peers) listener({ type: "presence", peer, alice });
    page.listeners.add(listener);
    return () => {
      page.listeners.delete(listener);
    };
  }

  #forgetTheSilent(page: Page): void {
    const nowMs = this.now();
    for (const [peer, { heardAtMs }] of page.peers) {
      if (nowMs - heardAtMs <= PRESENCE_GONE_AFTER_MS) continue;
      page.peers.delete(peer);
      this.#tell(page, { type: "presence", peer, alice: null });
    }
  }

  #reaches(page: Page, since: number): boolean {
    const oldest = page.log[0];
    return oldest !== undefined && oldest.seq <= since + 1;
  }

  #tell(page: Page, message: FeedMessage): void {
    for (const listener of page.listeners) listener(message);
  }

  #page(boardId: string): Page {
    const existing = this.#pages.get(boardId);
    if (existing !== undefined) return existing;
    const page: Page = { seq: 0, log: [], listeners: new Set(), peers: new Map() };
    this.#pages.set(boardId, page);
    return page;
  }
}
