// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { NoteId } from "../../src/notes/types";
import {
  deletionOf,
  type FeedCursor,
  type FeedMessage,
  type Ghost,
  type PeerId,
} from "../../src/sync/wire";
import { BoardFeed, KEPT_BYTES, KEPT_CHANGES, PAGE_IDLE_MS } from "./boardFeed";

const note = (id: string, text = "hello") => ({
  type: "put" as const,
  kind: "notes" as const,
  id,
  entity: {
    id: id as NoteId,
    author: "player" as const,
    text,
    position: { x: 0, y: 0 },
    tone: "plain" as const,
    createdAt: 1,
    fleeting: false,
  },
});

const ghost = (x: number): Ghost => ({
  center: { x, y: 0 },
  velocity: { x: 0, y: 0 },
  width: 24,
  height: 48,
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

const BOOT = "thislife";

const feedAt = (now?: () => number) =>
  new BoardFeed({ boot: BOOT, ...(now === undefined ? {} : { now }) });

const heard = (feed: BoardFeed, boardId: string, since: number | FeedCursor | null) => {
  const messages: FeedMessage[] = [];
  const cursor = typeof since === "number" ? { boot: BOOT, seq: since } : since;
  const stop = feed.subscribe(boardId, cursor, (message) => messages.push(message));
  return { messages, stop };
};

const seqs = (messages: readonly FeedMessage[]): readonly number[] =>
  messages.flatMap((message) => ("seq" in message ? [message.seq] : []));

describe("BoardFeed", () => {
  it("numbers changes per board from 1 and tells whoever is listening", () => {
    const feed = feedAt();
    const { messages } = heard(feed, "a", null);
    expect(messages).toEqual([{ type: "cursor", seq: 0, boot: BOOT }]);
    expect(feed.record("a", note("n1")).seq).toBe(1);
    expect(feed.record("b", note("n2")).seq).toBe(1);
    expect(feed.record("a", deletionOf("notes", "n1")).seq).toBe(2);
    expect(messages.slice(1)).toEqual([
      { ...note("n1"), seq: 1 },
      { type: "delete", kind: "notes", id: "n1", seq: 2 },
    ]);
  });

  it("replays what a `since` cursor missed and nothing before it", () => {
    const feed = feedAt();
    for (let i = 1; i <= 5; i++) feed.record("a", note(`n${i}`));
    expect(seqs(heard(feed, "a", 3).messages)).toEqual([4, 5]);
    expect(seqs(heard(feed, "a", 5).messages)).toEqual([]);
    expect(heard(feed, "a", 0).messages).toHaveLength(5);
  });

  it("asks for a fresh load when the cursor is from another life or too far back", () => {
    const feed = feedAt();
    feed.record("a", note("n1"));
    expect(heard(feed, "a", 7).messages).toEqual([{ type: "resync", seq: 1, boot: BOOT }]);
    for (let i = 0; i < KEPT_CHANGES + 10; i++) feed.record("a", note(`n${i}`));
    expect(heard(feed, "a", 1).messages).toEqual([
      { type: "resync", seq: KEPT_CHANGES + 11, boot: BOOT },
    ]);
    expect(seqs(heard(feed, "a", 11).messages)[0]).toBe(12);
  });

  it("asks a cursor from another life of the server to reload, though its number is in range", () => {
    const before = feedAt();
    for (let i = 1; i <= 5; i++) before.record("a", note(`n${i}`));
    const restarted = new BoardFeed({ boot: "nextlife" });
    for (let i = 1; i <= 8; i++) restarted.record("a", note(`m${i}`));
    expect(heard(restarted, "a", before.cursorOf("a")).messages).toEqual([
      { type: "resync", seq: 8, boot: "nextlife" },
    ]);
    expect(seqs(heard(restarted, "a", { boot: "nextlife", seq: 5 }).messages)).toEqual([6, 7, 8]);
    expect(seqs(heard(restarted, "a", { boot: null, seq: 5 }).messages)).toEqual([6, 7, 8]);
  });

  it("says where a board's feed stands, in this life of the server", () => {
    const feed = feedAt();
    expect(feed.cursorOf("a")).toEqual({ boot: BOOT, seq: 0 });
    feed.record("a", note("n1"));
    expect(feed.cursorOf("a")).toEqual({ boot: BOOT, seq: 1 });
    expect(new BoardFeed().boot).toMatch(/^[a-z0-9]{1,32}$/);
    expect(new BoardFeed().boot).not.toBe(new BoardFeed().boot);
  });

  it("keeps no more of the log than its byte budget, and resyncs cursors from before it", () => {
    const feed = feedAt();
    const text = "x".repeat(256 * 1024);
    const changes = Math.ceil(KEPT_BYTES / text.length) + 5;
    for (let i = 1; i <= changes; i++) feed.record("a", note(`n${i}`, text));
    expect(heard(feed, "a", 0).messages).toEqual([{ type: "resync", seq: changes, boot: BOOT }]);
    expect(heard(feed, "a", 2).messages).toEqual([{ type: "resync", seq: changes, boot: BOOT }]);
    expect(seqs(heard(feed, "a", changes - 20).messages)).toHaveLength(20);
  });

  it("forgets an idle page with no listeners or peers, and numbers it on from where it stood", () => {
    let now = 0;
    const feed = feedAt(() => now);
    for (let i = 1; i <= 3; i++) feed.record("a", note(`n${i}`));
    const { stop } = heard(feed, "held", null);
    feed.announce("present", "ipad" as PeerId, ghost(0));
    expect(feed.pageCount).toBe(3);
    now += PAGE_IDLE_MS;
    const resumed = heard(feed, "a", 3);
    expect(resumed.messages).toEqual([]);
    resumed.stop();
    expect(feed.pageCount).toBe(2);
    expect(feed.peers("present")).toEqual([]);
    expect(feed.record("a", note("n4")).seq).toBe(4);
    const behind = heard(feed, "a", 1);
    expect(behind.messages).toEqual([{ type: "resync", seq: 4, boot: BOOT }]);
    behind.stop();
    stop();
    now += 2 * PAGE_IDLE_MS;
    expect(feed.record("fresh", note("n1")).seq).toBe(5);
    expect(feed.pageCount).toBe(1);
  });

  it("stops telling a listener that left", () => {
    const feed = feedAt();
    const { messages, stop } = heard(feed, "a", null);
    stop();
    feed.record("a", note("n1"));
    expect(messages).toHaveLength(1);
  });

  it("relays who is on the page, hands newcomers everyone already there, and clears the leavers", () => {
    const feed = feedAt();
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
      { type: "cursor", seq: 0, boot: BOOT },
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
