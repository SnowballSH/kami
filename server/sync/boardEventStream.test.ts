// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { NoteId } from "../../src/notes/types";
import type { PeerId } from "../../src/sync/wire";
import { boardEventStream, MAX_BACKLOG_BYTES } from "./boardEventStream";
import { BoardFeed } from "./boardFeed";

const CHANGE_BYTES = 64 * 1024;

const bulkyNote = (id: string) => ({
  type: "put" as const,
  kind: "notes" as const,
  id,
  entity: {
    id: id as NoteId,
    author: "player" as const,
    text: "x".repeat(CHANGE_BYTES),
    position: { x: 0, y: 0 },
    tone: "plain" as const,
    createdAt: 1,
    fleeting: false,
  },
});

describe("boardEventStream", () => {
  it("drops a reader that stops reading once its backlog passes the limit, and stops listening", async () => {
    const feed = new BoardFeed();
    const subscribe = feed.subscribe.bind(feed);
    const unsubscribed = vi.fn();
    vi.spyOn(feed, "subscribe").mockImplementation((...args) => {
      const stop = subscribe(...args);
      return () => {
        unsubscribed();
        stop();
      };
    });
    const leave = vi.spyOn(feed, "leave");
    const peer = "reader" as PeerId;
    const response = boardEventStream(feed, "board", { peer, keepAliveMs: 60_000 });
    const changes = Math.ceil(MAX_BACKLOG_BYTES / CHANGE_BYTES) + 2;
    for (let i = 0; i < changes; i++) feed.record("board", bulkyNote(`n${i}`));
    expect(unsubscribed).toHaveBeenCalledOnce();
    expect(leave).toHaveBeenCalledWith("board", peer);
    await expect(response.body?.getReader().read()).rejects.toThrow("fell behind");
  });

  it("keeps a reader that is behind by less than the limit", async () => {
    const feed = new BoardFeed();
    const leave = vi.spyOn(feed, "leave");
    const peer = "reader" as PeerId;
    const response = boardEventStream(feed, "board", { peer, keepAliveMs: 60_000 });
    feed.record("board", bulkyNote("n1"));
    feed.record("board", bulkyNote("n2"));
    expect(leave).not.toHaveBeenCalled();
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("id: 2\n")) text += decoder.decode((await reader?.read())?.value);
    await reader?.cancel();
    expect(leave).toHaveBeenCalledOnce();
  });
});
