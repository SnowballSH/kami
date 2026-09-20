import { describe, expect, it } from "vitest";
import { FakeEventSource } from "../controller/testing/fakeEventSource";
import type { Note, NoteId } from "../notes/types";
import type { AliceSnapshot } from "../sim/types";
import { BoardLink, boardEventsPath, PRESENCE_INTERVAL_MS, presencePath } from "./boardLink";
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
  width: 28,
  height: 60,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
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
