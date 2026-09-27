import { same } from "../core/same";
import type { FeedCursor } from "../persistence/types";
import type { AliceSnapshot } from "../sim/types";
import type { BoardChange, BoardLink, Ghost, PeerId } from "../sync";
import type { Detach, Hud, ShareInfo } from "../ui/types";
import type { GameClock } from "./context";

/**
 * A device says where its Alice is several times a second, so one silent this long has gone —
 * closed, asleep, or lost while the server restarted, the one way to leave without anyone being told.
 */
const GHOST_GONE_AFTER_MS = 5000;

export interface PageFollower {
  changed(change: BoardChange): void;
  /** The feed lost its place: the page must be loaded again and followed from there. */
  resync(): void;
}

/** This device on a shared page: the stream of other devices' changes, their Alices, and the share link. */
export class Presence {
  private unfollow: Detach | null = null;
  private readonly ghosts = new Map<
    PeerId,
    { readonly alice: Ghost; readonly heardAtMs: number }
  >();
  private shown: ShareInfo | null = null;

  /** `link` is null unless the mode shares pages live. */
  constructor(
    private readonly link: BoardLink | null,
    private readonly hud: Pick<Hud, "setShare">,
    private readonly shareLinkFor: ((boardId: string) => string) | null,
    private readonly clock: GameClock,
  ) {}

  get live(): boolean {
    return this.link !== null;
  }

  get following(): boolean {
    return this.unfollow !== null;
  }

  get company(): readonly Ghost[] {
    return [...this.ghosts.values()].map(({ alice }) => alice);
  }

  /** Hears what other devices do to the page from `since`, where its snapshot was read. */
  follow(boardId: string, since: FeedCursor | null, follower: PageFollower): void {
    this.leave();
    if (this.link === null) return;
    this.unfollow = this.link.follow(
      boardId,
      {
        changed: (change) => follower.changed(change),
        seen: (peer, alice) => {
          if (alice === null) this.ghosts.delete(peer);
          else this.ghosts.set(peer, { alice, heardAtMs: this.clock.nowMs });
        },
        resync: () => {
          this.unfollow = null;
          follower.resync();
        },
      },
      since,
    );
  }

  leave(): void {
    this.unfollow?.();
    this.unfollow = null;
    this.ghosts.clear();
  }

  frame(boardId: string, alice: AliceSnapshot | null, announcing: boolean): void {
    const { nowMs } = this.clock;
    if (this.following && announcing && alice !== null) this.link?.announce(alice, nowMs);
    for (const [peer, { heardAtMs }] of this.ghosts)
      if (nowMs - heardAtMs > GHOST_GONE_AFTER_MS) this.ghosts.delete(peer);
    this.showShare(boardId);
  }

  private showShare(boardId: string): void {
    const share: ShareInfo | null =
      this.following && this.shareLinkFor !== null
        ? { boardId, link: this.shareLinkFor(boardId), company: this.ghosts.size }
        : null;
    if (same(this.shown, share)) return;
    this.shown = share;
    this.hud.setShare(share);
  }
}
