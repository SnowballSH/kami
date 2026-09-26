import { describe, expect, it } from "vitest";
import { FakeEventSource } from "../controller/testing/fakeEventSource";
import type { Note, NoteId } from "../notes/types";
import type { AliceSnapshot } from "../sim/types";
import {
  BoardLink,
  boardEventsPath,
  PRESENCE_INTERVAL_MS,
  presencePath,
  RECONNECT_BACKOFF_MS,
} from "./boardLink";
import { mintPeerId } from "./peer";
import { SharedPage } from "./testing/sharedPage";
import {
  type BoardChange,
  deletionOf,
  type FeedMessage,
  type PeerId,
  parseFeedMessage,
} from "./wire";

const ME = "peer-me" as PeerId;
const OTHER = "peer-other" as PeerId;
const BOARD = "our page";

const alice = (x: number): AliceSnapshot => ({
  center: { x, y: -40 },
  velocity: { x: 0, y: 0 },
  width: 28,
  height: 60,
  size: "normal",
  sizeMultiplier: 1,
  innateScale: 1,
  scale: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
  look: { kind: "alice" },
});

const NOTE: Note = {
  id: "n1" as NoteId,
  author: "player",
  text: "hello",
  position: { x: 0, y: 0 },
  tone: "plain",
  createdAt: 1,
  fleeting: false,
};

class Ears {
  readonly changes: BoardChange[] = [];
  readonly seen: [PeerId, AliceSnapshot | null][] = [];
  resyncs = 0;

  changed(change: BoardChange): void {
    this.changes.push(change);
  }

  seen_(peer: PeerId, alice: AliceSnapshot | null): void {
    this.seen.push([peer, alice]);
  }

  get listener() {
    return {
      changed: (change: BoardChange) => this.changed(change),
      seen: (peer: PeerId, alice: AliceSnapshot | null) => this.seen_(peer, alice),
      resync: () => {
        this.resyncs += 1;
      },
    };
  }
}

const linkWith = (posts: { url: string; body: unknown }[] = []) =>
  new BoardLink({
    peer: ME,
    openEventSource: (url) => new FakeEventSource(url),
    fetch: (url, init) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });

describe("BoardLink", () => {
  it("opens the board's event stream under its own peer id, and closes it when told to stop", () => {
    const link = linkWith();
    const stop = link.follow(BOARD, new Ears().listener);
    const source = FakeEventSource.latest();
    expect(source.url).toBe(boardEventsPath(BOARD, ME));
    expect(source.url).toBe("/api/boards/our%20page/events?peer=peer-me");
    expect(link.boardId).toBe(BOARD);
    stop();
    expect(source.closed).toBe(true);
    expect(link.boardId).toBeNull();
  });

  it("hands changes, others' presence and resyncs to the listener, and skips its own echo and cursors", () => {
    const link = linkWith();
    const ears = new Ears();
    link.follow(BOARD, ears.listener);
    const source = FakeEventSource.latest();
    const messages: FeedMessage[] = [
      { type: "cursor", seq: 4 },
      { seq: 5, type: "put", kind: "notes", id: NOTE.id, entity: NOTE },
      { seq: 6, ...deletionOf("notes", NOTE.id) },
      { seq: 7, type: "clear" },
      { type: "presence", peer: ME, alice: alice(1) },
      { type: "presence", peer: OTHER, alice: alice(2) },
      { type: "presence", peer: OTHER, alice: null },
      { type: "resync", seq: 7 },
    ];
    for (const message of messages) source.send(JSON.stringify(message));
    source.send("not json");
    source.send(JSON.stringify({ type: "unknown" }));
    expect(ears.changes.map((change) => change.type)).toEqual(["put", "delete", "clear"]);
    expect(ears.seen).toEqual([
      [OTHER, alice(2)],
      [OTHER, null],
    ]);
    expect(ears.resyncs).toBe(1);
  });

  it("follows on from where the page was loaded, and hands each change on once", () => {
    const link = linkWith();
    const ears = new Ears();
    link.follow(BOARD, ears.listener, { boot: "life", seq: 5 });
    const source = FakeEventSource.latest();
    expect(source.url).toBe(`${boardEventsPath(BOARD, ME)}&since=life%3A5`);
    expect(source.url).toBe(boardEventsPath(BOARD, ME, { boot: "life", seq: 5 }));
    for (const seq of [4, 5, 6, 6, 7])
      source.send(JSON.stringify({ seq, type: "put", kind: "notes", id: NOTE.id, entity: NOTE }));
    expect(ears.changes.map((change) => change.seq)).toEqual([6, 7]);
  });

  it("takes the opening cursor as where it stands when it followed from now", () => {
    const link = linkWith();
    const ears = new Ears();
    link.follow(BOARD, ears.listener);
    const source = FakeEventSource.latest();
    source.send(JSON.stringify({ type: "cursor", seq: 3, boot: "life" }));
    source.send(JSON.stringify({ seq: 3, type: "clear" }));
    source.send(JSON.stringify({ seq: 4, type: "clear" }));
    expect(ears.changes.map((change) => change.seq)).toEqual([4]);
  });

  it("stops the stream when told to reload, and hears nothing more from it", () => {
    const link = linkWith();
    const ears = new Ears();
    link.follow(BOARD, ears.listener, { boot: "life", seq: 0 });
    const source = FakeEventSource.latest();
    source.send(JSON.stringify({ type: "resync", seq: 9, boot: "life" }));
    source.send(JSON.stringify({ seq: 10, type: "clear" }));
    expect(ears.resyncs).toBe(1);
    expect(source.closed).toBe(true);
    expect(link.boardId).toBeNull();
    expect(ears.changes).toEqual([]);
  });

  describe("when the server closes the stream for good", () => {
    const withTimers = () => {
      const waits: { readonly ms: number; readonly run: () => void; cancelled: boolean }[] = [];
      const link = new BoardLink({
        peer: ME,
        openEventSource: (url) => new FakeEventSource(url),
        fetch: () => Promise.resolve(new Response(null, { status: 204 })),
        schedule: (run, ms) => {
          const wait = { ms, run, cancelled: false };
          waits.push(wait);
          return () => {
            wait.cancelled = true;
          };
        },
      });
      const elapse = () => {
        const wait = waits.at(-1);
        if (wait !== undefined && !wait.cancelled) wait.run();
      };
      return { link, waits, elapse };
    };
    const change = (seq: number) =>
      JSON.stringify({ seq, type: "put", kind: "notes", id: NOTE.id, entity: NOTE });

    it("follows again from its last change, waiting longer after each failure", () => {
      const { link, waits, elapse } = withTimers();
      const ears = new Ears();
      link.follow(BOARD, ears.listener, { boot: "life", seq: 2 });
      const first = FakeEventSource.latest();
      first.send(change(3));
      first.die();
      expect(waits.map((wait) => wait.ms)).toEqual([RECONNECT_BACKOFF_MS.first]);
      elapse();
      const second = FakeEventSource.latest();
      expect(second).not.toBe(first);
      expect(second.url).toBe(boardEventsPath(BOARD, ME, { boot: "life", seq: 3 }));
      second.die();
      elapse();
      FakeEventSource.latest().die();
      expect(waits.map((wait) => wait.ms)).toEqual([
        RECONNECT_BACKOFF_MS.first,
        RECONNECT_BACKOFF_MS.first * 2,
        RECONNECT_BACKOFF_MS.first * 4,
      ]);
      elapse();
      const alive = FakeEventSource.latest();
      alive.send(change(3));
      alive.send(change(4));
      expect(ears.changes.map((heard) => heard.seq)).toEqual([3, 4]);
      alive.die();
      expect(waits.at(-1)?.ms).toBe(RECONNECT_BACKOFF_MS.first);
      expect(link.boardId).toBe(BOARD);
    });

    it("never waits longer than the cap", () => {
      const { link, waits, elapse } = withTimers();
      link.follow(BOARD, new Ears().listener, { boot: "life", seq: 0 });
      for (let i = 0; i < 12; i++) {
        FakeEventSource.latest().die();
        elapse();
      }
      expect(Math.max(...waits.map((wait) => wait.ms))).toBe(RECONNECT_BACKOFF_MS.max);
    });

    it("leaves a stream the browser is still reconnecting to itself", () => {
      const { link, waits } = withTimers();
      link.follow(BOARD, new Ears().listener, { boot: "life", seq: 0 });
      FakeEventSource.latest().fail();
      expect(waits).toEqual([]);
    });

    it("asks for a reload when it never learned where the stream stood", () => {
      const { link, elapse } = withTimers();
      const ears = new Ears();
      link.follow(BOARD, ears.listener);
      FakeEventSource.latest().die();
      expect(ears.resyncs).toBe(0);
      elapse();
      expect(ears.resyncs).toBe(1);
      expect(link.boardId).toBeNull();
    });

    it("forgets a pending retry once it stops following", () => {
      const { link, waits, elapse } = withTimers();
      link.follow(BOARD, new Ears().listener, { boot: "life", seq: 0 });
      const dead = FakeEventSource.latest();
      dead.die();
      link.unfollow();
      expect(waits[0]?.cancelled).toBe(true);
      elapse();
      expect(FakeEventSource.latest()).toBe(dead);
    });
  });

  it("stops listening to a stream it has left, even if it still speaks", () => {
    const link = linkWith();
    const ears = new Ears();
    link.follow(BOARD, ears.listener);
    const first = FakeEventSource.latest();
    link.follow("elsewhere", new Ears().listener);
    expect(first.closed).toBe(true);
    first.send(JSON.stringify({ type: "resync", seq: 0 }));
    expect(ears.resyncs).toBe(0);
  });

  it("reports where Alice is, no more often than a few times a second", () => {
    const posts: { url: string; body: unknown }[] = [];
    const link = linkWith(posts);
    link.announce(alice(0), 0);
    expect(posts).toHaveLength(0);
    link.follow(BOARD, new Ears().listener);
    link.announce(alice(1), 1_000);
    link.announce(alice(2), 1_000 + PRESENCE_INTERVAL_MS - 1);
    link.announce(alice(3), 1_000 + PRESENCE_INTERVAL_MS);
    expect(posts.map((post) => post.url)).toEqual([presencePath(BOARD), presencePath(BOARD)]);
    expect(posts.map((post) => post.body)).toEqual([
      { peer: ME, alice: alice(1) },
      { peer: ME, alice: alice(3) },
    ]);
  });

  it("swallows a failed presence report", async () => {
    const link = new BoardLink({
      peer: ME,
      openEventSource: (url) => new FakeEventSource(url),
      fetch: () => Promise.reject(new Error("offline")),
    });
    link.follow(BOARD, new Ears().listener);
    expect(() => link.announce(alice(1), 1_000)).not.toThrow();
    await Promise.resolve();
  });
});

describe("mintPeerId", () => {
  it("mints ids the wire accepts, different for every tab", () => {
    const a = mintPeerId(() => 0.1);
    const b = mintPeerId(() => 0.9);
    expect(a).not.toBe(b);
    for (const id of [a, b]) {
      const heard = parseFeedMessage(JSON.stringify({ type: "presence", peer: id, alice: null }));
      expect(heard?.type).toBe("presence");
    }
  });
});

describe("SharedPage (the server, in memory)", () => {
  it("relays what one device saves to every device on the same page, numbered in order", () => {
    const page = new SharedPage();
    const mine = new Ears();
    const theirs = new Ears();
    const elsewhere = new Ears();
    page.link(ME).follow(BOARD, mine.listener);
    page.link(OTHER).follow(BOARD, theirs.listener);
    page.link("peer-far" as PeerId).follow("another page", elsewhere.listener);
    page.saveNote(BOARD, NOTE);
    page.deleteNote(BOARD, NOTE.id);
    page.clear(BOARD);
    const heard = (ears: Ears) => ears.changes.map((change) => `${change.seq}:${change.type}`);
    expect(heard(mine)).toEqual(["1:put", "2:delete", "3:clear"]);
    expect(heard(theirs)).toEqual(heard(mine));
    expect(heard(elsewhere)).toEqual([]);
  });

  it("carries presence between devices and says when one is dropped", () => {
    const page = new SharedPage();
    const mine = new Ears();
    const theirs = new Ears();
    const myLink = page.link(ME);
    myLink.follow(BOARD, mine.listener);
    page.link(OTHER).follow(BOARD, theirs.listener);
    expect(page.peersOn(BOARD)).toEqual([ME, OTHER]);
    myLink.announce(alice(7), 1_000);
    expect(theirs.seen).toEqual([[ME, alice(7)]]);
    expect(mine.seen).toEqual([]);
    page.drop(ME);
    expect(theirs.seen.at(-1)).toEqual([ME, null]);
    expect(page.peersOn(BOARD)).toEqual([OTHER]);
  });
});
