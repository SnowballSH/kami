import type {
  BoardChange,
  BoardEdit,
  FeedCursor,
  FeedMessage,
  Ghost,
  PeerId,
} from "../../src/sync/wire";

export type Publish = (message: FeedMessage) => void;

export type Unsubscribe = () => void;

/** How many changes, and how many bytes of them, a board keeps for clients that reconnect with a `since` cursor. */
export const KEPT_CHANGES = 2_000;
export const KEPT_BYTES = 8 * 1024 * 1024;

/** A page nobody has listened to, announced on or changed for this long is forgotten. */
export const PAGE_IDLE_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 60_000;

/**
 * A device announces its Alice several times a second. One that has been silent this long has gone,
 * whether or not its event stream ever told us: an announcement can arrive after the stream closed,
 * and nothing else would ever withdraw that ghost.
 */
export const PRESENCE_GONE_AFTER_MS = 5_000;

const BOOT_LENGTH = 12;

/** A name for this process's life, so a cursor from before a restart is never read in the new numbering. */
export const mintBoot = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, BOOT_LENGTH);

export interface BoardFeedOptions {
  readonly now?: () => number;
  readonly boot?: string;
}

interface Page {
  seq: number;
  touchedAtMs: number;
  logBytes: number;
  readonly log: { readonly change: BoardChange; readonly bytes: number }[];
  readonly listeners: Set<Publish>;
  readonly peers: Map<PeerId, { readonly alice: Ghost; readonly heardAtMs: number }>;
}

/**
 * What happened on each board since the server started, numbered, and who is on it right now: the
 * live side of the board repository. In memory on purpose — the repository remembers, this relays.
 */
export class BoardFeed {
  readonly boot: string;
  readonly #now: () => number;
  readonly #pages = new Map<string, Page>();
  /**
   * The highest number any forgotten board had reached. A new page counts on from here, so a cursor a
   * client kept from a forgotten page is never mistaken for one in the new numbering.
   */
  #forgottenSeq = 0;
  #sweptAtMs: number;

  constructor({ now = Date.now, boot = mintBoot() }: BoardFeedOptions = {}) {
    this.boot = boot;
    this.#now = now;
    this.#sweptAtMs = now();
  }

  get pageCount(): number {
    return this.#pages.size;
  }

  record(boardId: string, edit: BoardEdit): BoardChange {
    const page = this.#page(boardId);
    page.seq += 1;
    const sequenced: BoardChange = { ...edit, seq: page.seq };
    const bytes = Buffer.byteLength(JSON.stringify(sequenced));
    page.log.push({ change: sequenced, bytes });
    page.logBytes += bytes;
    while (page.log.length > KEPT_CHANGES || page.logBytes > KEPT_BYTES) {
      page.logBytes -= page.log.shift()?.bytes ?? 0;
    }
    this.#tell(page, sequenced);
    return sequenced;
  }

  announce(boardId: string, peer: PeerId, alice: Ghost): void {
    const page = this.#page(boardId);
    page.peers.set(peer, { alice, heardAtMs: this.#now() });
    this.#tell(page, { type: "presence", peer, alice });
    this.#forgetTheSilent(page);
  }

  leave(boardId: string, peer: PeerId): void {
    const page = this.#pages.get(boardId);
    if (page === undefined || !page.peers.delete(peer)) return;
    this.#tell(page, { type: "presence", peer, alice: null });
  }

  /** Where the board's feed stands now: a snapshot read after this misses nothing a follower would. */
  cursorOf(boardId: string): FeedCursor {
    return { boot: this.boot, seq: this.#page(boardId).seq };
  }

  peers(boardId: string): readonly PeerId[] {
    const page = this.#pages.get(boardId);
    if (page === undefined) return [];
    this.#forgetTheSilent(page);
    return [...page.peers.keys()];
  }

  /**
   * Catches the listener up, then keeps it posted. With no `since` it hears where the log stands
   * (`cursor`) and the board is expected to be loaded afresh; with one, every change after it — or
   * `resync` when that is further back than the log reaches, or from another life of the server. A
   * cursor without a boot is taken to be from this one.
   */
  subscribe(boardId: string, since: FeedCursor | null, listener: Publish): Unsubscribe {
    const page = this.#page(boardId);
    if (since === null) listener({ type: "cursor", seq: page.seq, boot: this.boot });
    else if (!this.#follows(page, since))
      listener({ type: "resync", seq: page.seq, boot: this.boot });
    else for (const { change } of page.log) if (change.seq > since.seq) listener(change);
    this.#forgetTheSilent(page);
    for (const [peer, { alice }] of page.peers) listener({ type: "presence", peer, alice });
    page.listeners.add(listener);
    return () => {
      page.listeners.delete(listener);
      page.touchedAtMs = this.#now();
    };
  }

  #forgetTheSilent(page: Page): void {
    const nowMs = this.#now();
    for (const [peer, { heardAtMs }] of page.peers) {
      if (nowMs - heardAtMs <= PRESENCE_GONE_AFTER_MS) continue;
      page.peers.delete(peer);
      this.#tell(page, { type: "presence", peer, alice: null });
    }
  }

  #follows(page: Page, { boot, seq }: FeedCursor): boolean {
    if (boot !== null && boot !== this.boot) return false;
    if (seq === page.seq) return true;
    const oldest = page.log[0];
    return seq < page.seq && oldest !== undefined && oldest.change.seq <= seq + 1;
  }

  #tell(page: Page, message: FeedMessage): void {
    for (const listener of page.listeners) listener(message);
  }

  #page(boardId: string): Page {
    const nowMs = this.#now();
    if (nowMs - this.#sweptAtMs >= SWEEP_EVERY_MS) this.#sweep(nowMs);
    const existing = this.#pages.get(boardId);
    if (existing !== undefined) {
      existing.touchedAtMs = nowMs;
      return existing;
    }
    const page: Page = {
      seq: this.#forgottenSeq,
      touchedAtMs: nowMs,
      logBytes: 0,
      log: [],
      listeners: new Set(),
      peers: new Map(),
    };
    this.#pages.set(boardId, page);
    return page;
  }

  #sweep(nowMs: number): void {
    this.#sweptAtMs = nowMs;
    for (const [boardId, page] of this.#pages) {
      this.#forgetTheSilent(page);
      const idle = page.listeners.size === 0 && page.peers.size === 0;
      if (!idle || nowMs - page.touchedAtMs < PAGE_IDLE_MS) continue;
      this.#forgottenSeq = Math.max(this.#forgottenSeq, page.seq);
      this.#pages.delete(boardId);
    }
  }
}
