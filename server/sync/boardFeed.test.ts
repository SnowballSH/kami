// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NoteId } from "../../src/notes/types";
import { deletionOf, type FeedMessage, type Ghost, type PeerId } from "../../src/sync/wire";
import { BoardFeed, KEPT_CHANGES } from "./boardFeed";

const note = (id: string) => ({
  type: "put" as const,
  kind: "notes" as const,
  id,
  entity: {
    id: id as NoteId,
    author: "player" as const,
    text: "hello",
    position: { x: 0, y: 0 },
    tone: "plain" as const,
    createdAt: 1,
    fleeting: false,
  },
});

const ghost = (x: number): Ghost => ({
  center: { x, y: 0 },
  width: 24,
  height: 48,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  velocity: { x: 0, y: 0 },
  ride: null,
  look: { kind: "alice" },
});

const heard = (feed: BoardFeed, boardId: string, since: number | null) => {
  const messages: FeedMessage[] = [];
  const stop = feed.subscribe(boardId, since, (message) => messages.push(message));
  return { messages, stop };
};

const seqs = (messages: readonly FeedMessage[]): readonly number[] =>
  messages.flatMap((message) => ("seq" in message ? [message.seq] : []));

describe("BoardFeed", () => {
  it("numbers changes per board from 1 and tells whoever is listening", () => {
    const feed = new BoardFeed();
    const { messages } = heard(feed, "a", null);
    expect(messages).toEqual([{ type: "cursor", seq: 0 }]);
    expect(feed.record("a", note("n1")).seq).toBe(1);
    expect(feed.record("b", note("n2")).seq).toBe(1);
    expect(feed.record("a", deletionOf("notes", "n1")).seq).toBe(2);
    expect(messages.slice(1)).toEqual([
      { ...note("n1"), seq: 1 },
      { type: "delete", kind: "notes", id: "n1", seq: 2 },
    ]);
  });

  it("replays what a `since` cursor missed and nothing before it", () => {
    const feed = new BoardFeed();
    for (let i = 1; i <= 5; i++) feed.record("a", note(`n${i}`));
    expect(seqs(heard(feed, "a", 3).messages)).toEqual([4, 5]);
    expect(seqs(heard(feed, "a", 5).messages)).toEqual([]);
    expect(heard(feed, "a", 0).messages).toHaveLength(5);
  });

  it("asks for a fresh load when the cursor is from another life or too far back", () => {
    const feed = new BoardFeed();
    feed.record("a", note("n1"));
    expect(heard(feed, "a", 7).messages).toEqual([{ type: "resync", seq: 1 }]);
    for (let i = 0; i < KEPT_CHANGES + 10; i++) feed.record("a", note(`n${i}`));
    expect(heard(feed, "a", 1).messages).toEqual([{ type: "resync", seq: KEPT_CHANGES + 11 }]);
    expect(seqs(heard(feed, "a", 11).messages)[0]).toBe(12);
  });

  it("stops telling a listener that left", () => {
    const feed = new BoardFeed();
    const { messages, stop } = heard(feed, "a", null);
    stop();
    feed.record("a", note("n1"));
    expect(messages).toHaveLength(1);
  });

  it("relays who is on the page, hands newcomers everyone already there, and clears the leavers", () => {
    const feed = new BoardFeed();
    const ipad = "ipad" as PeerId;
    const laptop = "laptop" as PeerId;
    const { messages } = heard(feed, "a", null);
    feed.announce("a", ipad, ghost(10));
    feed.announce("a", ipad, ghost(20));
    expect(messages.slice(1)).toEqual([
      { type: "presence", peer: ipad, alice: ghost(10) },
      { type: "presence", peer: ipad, alice: ghost(20) },
    ]);
    const late = heard(feed, "a", null);
    expect(late.messages).toEqual([
      { type: "cursor", seq: 0 },
      { type: "presence", peer: ipad, alice: ghost(20) },
    ]);
    feed.announce("a", laptop, ghost(0));
    expect(feed.peers("a")).toEqual([ipad, laptop]);
    feed.leave("a", ipad);
    feed.leave("a", ipad);
    expect(late.messages.slice(2)).toEqual([
      { type: "presence", peer: laptop, alice: ghost(0) },
      { type: "presence", peer: ipad, alice: null },
    ]);
    expect(feed.peers("a")).toEqual([laptop]);
  });
});
