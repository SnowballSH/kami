import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { NoteId } from "../../src/notes/types";
import type { PeerId } from "../../src/sync/wire";
import { pacesResponseBodies } from "../http/eventStream";
import { boardEventStream, MAX_BACKLOG_BYTES, sinceOf } from "./boardEventStream";
import { BoardFeed } from "./boardFeed";
import type { ProbeMode, StalledReaderReport } from "./testing/stalledReaderProbe";

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

  it("catches up an old cursor over the whole kept log without dropping the reader", async () => {
    const feed = new BoardFeed({ boot: "life" });
    const changes = Math.ceil((1.5 * MAX_BACKLOG_BYTES) / CHANGE_BYTES);
    for (let i = 0; i < changes; i++) feed.record("board", bulkyNote(`n${i}`));
    const response = boardEventStream(feed, "board", {
      since: { boot: "life", seq: 0 },
      keepAliveMs: 60_000,
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes(`id: life:${changes}\n`)) {
      const { value, done } = (await reader?.read()) ?? { done: true };
      if (done) break;
      text += decoder.decode(value);
    }
    await reader?.cancel();
    expect(text).toContain('"type":"resync"');
  });
});

const BUN = process.versions.bun === undefined ? "bun" : process.execPath;
const BUN_VERSION = execFileSync(BUN, ["--version"], { encoding: "utf8" }).trim();
const PROBE = fileURLToPath(new URL("./testing/stalledReaderProbe.ts", import.meta.url));
/** What Bun and the kernel may hold for a connection once Bun stops pulling: measured ~2.9 MB on 1.4.2. */
const MOST_IN_FLIGHT_BYTES = 16 * 1024 * 1024;

const probe = (mode: ProbeMode): StalledReaderReport =>
  JSON.parse(execFileSync(BUN, [PROBE, mode], { encoding: "utf8", timeout: 60_000 }));

describe.runIf(pacesResponseBodies(BUN_VERSION))(
  `a real Bun.serve connection that stops reading (Bun ${BUN_VERSION})`,
  () => {
    it("is dropped once its backlog passes the limit, with what the server holds bounded", () => {
      const report = probe("flood");
      expect(report.end?.reason).toBe("fell-behind");
      expect(report.end?.peakBacklogBytes).toBeLessThanOrEqual(MAX_BACKLOG_BYTES + 512 * 1024);
      expect(report.end?.deliveredBytes).toBeLessThan(MOST_IN_FLIGHT_BYTES);
      expect(report.caughtUp).toBe(true);
      expect(report.resyncedFromStart).toBe(true);
    }, 60_000);

    it("is dropped at the stall deadline when the backlog stays under the limit", () => {
      const report = probe("trickle");
      expect(report.end?.reason).toBe("stalled");
      expect(report.end?.deliveredBytes).toBeLessThan(MOST_IN_FLIGHT_BYTES);
      expect(report.caughtUp).toBe(true);
    }, 60_000);
  },
);

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
