// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { NoteId } from "../../src/notes/types";
import type { PeerId } from "../../src/sync/wire";
import { boardEventStream, MAX_BACKLOG_BYTES, sinceOf } from "./boardEventStream";
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
    const feed = new BoardFeed({ boot: "life" });
    const leave = vi.spyOn(feed, "leave");
    const peer = "reader" as PeerId;
    const response = boardEventStream(feed, "board", { peer, keepAliveMs: 60_000 });
    feed.record("board", bulkyNote("n1"));
    feed.record("board", bulkyNote("n2"));
    expect(leave).not.toHaveBeenCalled();
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("id: life:2\n")) text += decoder.decode((await reader?.read())?.value);
    await reader?.cancel();
    expect(leave).toHaveBeenCalledOnce();
  });
});

describe("sinceOf", () => {
  const request = (query: string, lastEventId?: string) =>
    new Request(`http://kami.test/api/boards/b/events${query}`, {
      headers: lastEventId === undefined ? {} : { "last-event-id": lastEventId },
    });

  it("reads a cursor with or without the server's boot, and nothing else", () => {
    expect(sinceOf(request("?since=life:7"))).toEqual({ boot: "life", seq: 7 });
    expect(sinceOf(request("?since=7"))).toEqual({ boot: null, seq: 7 });
    expect(sinceOf(request(""))).toBeNull();
    for (const bad of ["-1", "1.5", "LIFE:2", "life:", ":3", "x:y"])
      expect(sinceOf(request(`?since=${bad}`))).toBeNull();
  });

  it("prefers the browser's own Last-Event-ID, which is always newer than the url's since", () => {
    expect(sinceOf(request("?since=life:7", "life:9"))).toEqual({ boot: "life", seq: 9 });
    expect(sinceOf(request("", "4"))).toEqual({ boot: null, seq: 4 });
  });
});
