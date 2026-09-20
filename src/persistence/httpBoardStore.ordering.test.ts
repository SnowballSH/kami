import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingId } from "../ink/types";
import type { FetchLike } from "./api";
import { HttpBoardStore } from "./httpBoardStore";
import { PERSISTENCE_TIMEOUT_MS } from "./requestDeadline";
import type { StoredDrawing } from "./types";

const stored: StoredDrawing = {
  drawing: { id: "drawing" as DrawingId, strokes: [[{ x: 1, y: 2 }]], cost: 3 },
  ruling: null,
};
const empty = { drawings: [], notes: [], rules: [] };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("board read barriers", () => {
  it.each(["save", "erase", "clear", "clear then save"] as const)(
    "reopening observes %s without waiting on another board",
    async (operation) => {
      const held = Promise.withResolvers<void>();
      const unrelated = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      let drawings = operation === "save" ? [] : [stored];
      const calls: string[] = [];
      let pending = true;
      const fetch: FetchLike = async (path, init) => {
        const method = init?.method ?? "GET";
        calls.push(`${method} ${path}`);
        if (path.includes("/elsewhere/")) await unrelated.promise;
        else if (method !== "GET") {
          if (pending) {
            pending = false;
            started.resolve();
            await held.promise;
          }
          drawings = method === "PUT" ? [stored] : [];
        }
        return Response.json({ ...empty, drawings });
      };
      const store = new HttpBoardStore(fetch);
      store.saveDrawing("elsewhere", stored);
      if (operation === "save") store.saveDrawing("demo", stored);
      else if (operation === "erase") store.deleteDrawing("demo", stored.drawing.id);
      else {
        store.clear("demo");
        if (operation === "clear then save") store.saveDrawing("demo", stored);
      }
      const reopened = store.load("demo");
      await started.promise;
      expect(calls).not.toContain("GET /api/boards/demo");
      held.resolve();
      expect(await reopened).toEqual({
        ...empty,
        drawings: operation === "save" || operation === "clear then save" ? [stored] : [],
      });
      unrelated.resolve();
      await store.whenIdle();
    },
  );

  it("holds subsequent writes until the read finishes and leaves other boards free", async () => {
    const held = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const calls: string[] = [];
    const store = new HttpBoardStore(async (path, init) => {
      calls.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/api/boards/demo") {
        started.resolve();
        await held.promise;
      }
      return Response.json(empty);
    });
    const read = store.load("demo");
    store.saveDrawing("demo", stored);
    await started.promise;
    expect(await store.load("elsewhere")).toEqual(empty);
    expect(calls).toEqual(["GET /api/boards/demo", "GET /api/boards/elsewhere"]);
    held.resolve();
    await read;
    await store.whenIdle();
    expect(calls.at(-1)).toBe("PUT /api/boards/demo/drawings/drawing");
  });

  it.each(["failure", "timeout"] as const)(
    "settles a %s before clear and reopen, including a transport that ignores abort",
    async (failure) => {
      vi.useFakeTimers();
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      let signal: AbortSignal | null | undefined;
      const calls: string[] = [];
      const store = new HttpBoardStore(async (_path, init) => {
        const method = init?.method ?? "GET";
        calls.push(method);
        if (method === "PUT") {
          signal = init?.signal;
          if (failure === "failure") return new Response(null, { status: 500 });
          return await new Promise<Response>(() => undefined);
        }
        return Response.json(empty);
      });
      store.saveDrawing("demo", stored);
      store.clear("demo");
      const reopened = store.load("demo");
      await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);
      expect(await reopened).toEqual(empty);
      expect(calls).toEqual(["PUT", "DELETE", "GET"]);
      expect(signal?.aborted).toBe(failure === "timeout");
      await store.whenIdle();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("bounds a stalled response body and lets a later write proceed", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls: string[] = [];
    const store = new HttpBoardStore(async (_path, init) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      return method === "GET"
        ? new Response(new ReadableStream<Uint8Array>())
        : Response.json({ ok: true });
    });
    const read = store.load("demo");
    store.saveDrawing("demo", stored);
    await vi.advanceTimersByTimeAsync(PERSISTENCE_TIMEOUT_MS);
    expect(await read).toEqual({ ...empty, drawings: [stored] });
    expect(store.state("demo").errors).toContainEqual({ operation: "load", reason: "timeout" });
    await store.whenIdle();
    expect(calls).toEqual(["GET", "PUT"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
