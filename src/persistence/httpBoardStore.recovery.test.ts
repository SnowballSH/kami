import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { FetchLike } from "./api";
import { HttpBoardStore } from "./httpBoardStore";
import { PERSISTENCE_TIMEOUT_MS } from "./requestDeadline";
import type { BoardSnapshot, StoredDrawing } from "./types";
import { guardUnsavedChanges } from "./unsavedGuard";

const empty: BoardSnapshot = { drawings: [], notes: [], rules: [] };
const drawing: StoredDrawing = {
  drawing: { id: "drawing-1" as DrawingId, strokes: [[{ x: 0, y: 0 }]], cost: 1 },
  ruling: null,
};
const note: Note = {
  id: "note-1" as NoteId,
  author: "player",
  text: "moon",
  position: { x: 0, y: 0 },
  tone: "understood",
  createdAt: 1,
  fleeting: false,
};

class Server {
  failure: "offline" | number | null = null;
  snapshot: BoardSnapshot = empty;
  readonly calls: string[] = [];
  readonly fetch: FetchLike = async (path, init) => {
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${path}`);
    if (this.failure === "offline") throw new TypeError("offline");
    if (this.failure !== null) return new Response(null, { status: this.failure });
    if (method === "GET") {
      return Response.json(path === "/api/boards" ? { boards: [] } : this.snapshot);
    }
    if (method === "DELETE") {
      this.snapshot = path.endsWith("/demo")
        ? empty
        : path.includes("/drawings/")
          ? { ...this.snapshot, drawings: [] }
          : { ...this.snapshot, notes: [] };
    } else if (path.includes("/drawings/")) {
      this.snapshot = { ...this.snapshot, drawings: [drawing] };
    } else {
      this.snapshot = { ...this.snapshot, notes: [note] };
    }
    return Response.json({ ok: true });
  };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("explicit board recovery", () => {
  it.each(["offline", 400, 503] as const)(
    "exposes %s failures and acknowledges only successful retries",
    async (failure) => {
      const server = new Server();
      server.failure = failure;
      const store = new HttpBoardStore(server.fetch);
      store.saveDrawing("demo", drawing);
      expect(store.state("demo")).toMatchObject({ saving: true, unsaved: 1 });
      await store.whenIdle();
      expect(store.hasUnsavedChanges).toBe(true);
      expect(store.state("demo")).toMatchObject({
        saving: false,
        unsaved: 1,
        errors: [{ operation: "save", reason: failure === "offline" ? "network" : "http" }],
      });
      if (typeof failure === "number") expect(store.state("demo").errors[0]?.status).toBe(failure);
      const attempts = server.calls.length;
      await store.whenIdle();
      expect(server.calls).toHaveLength(attempts);
      server.failure = null;
      await store.retry("demo");
      expect(store.state("demo")).toEqual({
        loading: false,
        saving: false,
        unsaved: 0,
        errors: [],
      });
      expect(store.hasUnsavedChanges).toBe(false);
      expect(server.snapshot.drawings).toEqual([drawing]);
    },
  );

  it("reopens an offline board with local edits and never reports it as saved", async () => {
    const server = new Server();
    server.snapshot = { ...empty, notes: [note] };
    const store = new HttpBoardStore(server.fetch);
    await store.load("demo");
    server.failure = "offline";
    store.saveDrawing("demo", drawing);
    await store.whenIdle();
    expect(await store.load("demo")).toEqual({ drawings: [drawing], notes: [note], rules: [] });
    expect(store.state("demo")).toMatchObject({ unsaved: 1, loading: false });
    expect(store.state("demo").errors).toContainEqual({ operation: "load", reason: "network" });
    server.failure = null;
    await store.retry("demo");
    expect(await store.load("demo")).toEqual({ drawings: [drawing], notes: [note], rules: [] });
    expect(store.state("demo").errors).toEqual([]);
  });

  it("overlays unsaved edits on a readable remote board instead of dropping them", async () => {
    const server = new Server();
    server.snapshot = { ...empty, notes: [note] };
    const store = new HttpBoardStore(server.fetch);
    server.failure = 503;
    store.saveDrawing("demo", drawing);
    await store.whenIdle();
    server.failure = null;
    expect(await store.load("demo")).toEqual({ drawings: [drawing], notes: [note], rules: [] });
    expect(store.state("demo").unsaved).toBe(1);
  });

  it("does not retry an old save after erasing its entity", async () => {
    const server = new Server();
    server.failure = "offline";
    const store = new HttpBoardStore(server.fetch);
    store.saveDrawing("demo", drawing);
    await store.whenIdle();
    store.deleteDrawing("demo", drawing.drawing.id);
    await store.whenIdle();
    server.failure = null;
    const before = server.calls.length;
    await store.retry("demo");
    expect(server.calls.slice(before)).toEqual(["DELETE /api/boards/demo/drawings/drawing-1"]);
    expect(await store.load("demo")).toEqual(empty);
  });

  it("shares an active attempt without duplicate requests or premature retry completion", async () => {
    const held = Promise.withResolvers<Response>();
    const fetch = vi.fn<FetchLike>(() => held.promise);
    const store = new HttpBoardStore(fetch);
    store.saveDrawing("demo", drawing);
    let complete = false;
    const retry = store.retry("demo").then(() => {
      complete = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(complete).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    held.resolve(Response.json({ ok: true }));
    await retry;
    expect(complete).toBe(true);
    expect(store.state("demo").unsaved).toBe(0);
  });

  it("retries a failed clear before new work and discards pre-clear failures", async () => {
    const server = new Server();
    server.failure = 500;
    const store = new HttpBoardStore(server.fetch);
    store.saveDrawing("demo", drawing);
    await store.whenIdle();
    store.clear("demo");
    store.saveNote("demo", note);
    await store.whenIdle();
    expect(store.state("demo").unsaved).toBe(2);
    expect(server.calls).not.toContain("PUT /api/boards/demo/notes/note-1");
    expect(await store.load("demo")).toEqual({ ...empty, notes: [note] });
    server.failure = null;
    const before = server.calls.length;
    await store.retry("demo");
    expect(server.calls.slice(before)).toEqual([
      "DELETE /api/boards/demo",
      "PUT /api/boards/demo/notes/note-1",
    ]);
    expect(await store.load("demo")).toEqual({ ...empty, notes: [note] });
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it.each(["erase", "clear"] as const)(
    "keeps an in-flight retry ordered before %s",
    async (action) => {
      const server = new Server();
      server.failure = 503;
      const held = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      let hold = false;
      const store = new HttpBoardStore(async (path, init) => {
        if (hold && init?.method === "PUT") {
          started.resolve();
          await held.promise;
        }
        return server.fetch(path, init);
      });
      store.saveDrawing("demo", drawing);
      await store.whenIdle();
      server.failure = null;
      hold = true;
      const retry = store.retry("demo");
      await started.promise;
      if (action === "erase") store.deleteDrawing("demo", drawing.drawing.id);
      else store.clear("demo");
      held.resolve();
      await retry;
      await store.whenIdle();
      await store.retry("demo");
      expect(server.snapshot).toEqual(empty);
      expect(server.calls.at(-1)).toBe(
        action === "erase"
          ? "DELETE /api/boards/demo/drawings/drawing-1"
          : "DELETE /api/boards/demo",
      );
    },
  );

  it("skips a queued retry superseded by clear before it starts", async () => {
    const server = new Server();
    server.failure = "offline";
    const store = new HttpBoardStore(server.fetch);
    store.saveDrawing("demo", drawing);
    await store.whenIdle();
    server.failure = null;
    const before = server.calls.length;
    const retry = store.retry("demo");
    store.clear("demo");
    await retry;
    await store.whenIdle();
    expect(server.calls.slice(before)).toEqual(["DELETE /api/boards/demo"]);
  });

  it("keeps timed-out writes unsaved, aborts them, and recovers explicitly", async () => {
    vi.useFakeTimers();
    const server = new Server();
    let hung = true;
    let signal: AbortSignal | null | undefined;
    const store = new HttpBoardStore(async (path, init) => {
      if (hung) {
        signal = init?.signal;
        return await new Promise<Response>(() => undefined);
      }
      return server.fetch(path, init);
    });
    store.saveDrawing("demo", drawing);
    await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);
    await store.whenIdle();
    expect(signal?.aborted).toBe(true);
    expect(store.state("demo")).toMatchObject({
      saving: false,
      unsaved: 1,
      errors: [{ operation: "save", reason: "timeout" }],
    });
    hung = false;
    await store.retry("demo");
    expect(store.hasUnsavedChanges).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an initial load and board list failure without returning empty saved data", async () => {
    vi.useFakeTimers();
    const store = new HttpBoardStore(async () => new Response(new ReadableStream<Uint8Array>()));
    const load = expect(store.load("demo")).rejects.toThrow();
    const list = expect(store.listBoards()).rejects.toThrow();
    expect(store.state("demo").loading).toBe(true);
    await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);
    await Promise.all([load, list]);
    expect(store.state("demo")).toMatchObject({
      loading: false,
      errors: [
        { operation: "load", reason: "timeout" },
        { operation: "list", reason: "timeout" },
      ],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requests close confirmation for unsaved work on any board, until acknowledged", async () => {
    const server = new Server();
    server.failure = "offline";
    const store = new HttpBoardStore(server.fetch);
    const detach = guardUnsavedChanges(window, store);
    const closing = (): boolean =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    expect(closing()).toBe(true);
    store.saveDrawing("elsewhere", drawing);
    await store.whenIdle();
    expect(store.state("demo").unsaved).toBe(0);
    expect(closing()).toBe(false);
    server.failure = null;
    await store.retry("elsewhere");
    expect(closing()).toBe(true);
    detach();
    store.saveDrawing("elsewhere", drawing);
    expect(closing()).toBe(true);
    await store.whenIdle();
  });
});
