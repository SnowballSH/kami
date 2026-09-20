import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { Rule, RuleId } from "../rules/types";
import type { FetchLike } from "./api";
import { HttpBoardStore } from "./httpBoardStore";
import type { BoardSnapshot, StoredDrawing } from "./types";

const stored: StoredDrawing = {
  drawing: { id: "drawing-1" as DrawingId, strokes: [[{ x: 1, y: 2 }]], cost: 3 },
  ruling: null,
};

const note: Note = {
  id: "note 1" as NoteId,
  author: "player",
  text: "g = moon",
  position: { x: 0, y: 0 },
  tone: "understood",
  createdAt: 1,
  fleeting: false,
};

const rule: Rule = {
  id: "rule-1" as RuleId,
  effect: { governs: "gravity", x: 0, y: 0.165 },
  explanation: "gravity = 0.17 g (the Moon)",
  sourceText: "g = moon",
  noteId: note.id,
  position: { x: 0, y: 0 },
  createdAt: 1,
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

class FakeServer {
  readonly calls: Call[] = [];
  readonly #held = new Map<string, () => void>();
  #holding: string | null = null;

  holdNext(pathFragment: string): void {
    this.#holding = pathFragment;
  }

  release(pathFragment: string): void {
    this.#held.get(pathFragment)?.();
  }

  readonly fetch: FetchLike = async (path, init) => {
    const method = init?.method ?? "GET";
    const held = this.#holding;
    if (held !== null && path.includes(held)) {
      this.#holding = null;
      await new Promise<void>((resolve) => this.#held.set(held, resolve));
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path, body });
    return Response.json({ ok: true });
  };
}

const offline: FetchLike = async () => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HttpBoardStore reads", () => {
  it("loads a board's snapshot from the server", async () => {
    const snapshot: BoardSnapshot = { drawings: [stored], notes: [note], rules: [rule] };
    const seen: string[] = [];
    const store = new HttpBoardStore(async (path) => {
      seen.push(path);
      return Response.json(snapshot);
    });
    expect(await store.load("my game")).toEqual(snapshot);
    expect(seen).toEqual(["/api/boards/my%20game"]);
  });

  it("lists boards", async () => {
    const boards = [{ id: "wonderland", drawings: 2, rules: 1 }];
    const store = new HttpBoardStore(async () => Response.json({ boards }));
    expect(await store.listBoards()).toEqual(boards);
  });

  it("reports unavailable saved data instead of confirming an empty board", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: FetchLike = async () => new Response("boom", { status: 500 });
    for (const fetchFn of [offline, broken]) {
      const store = new HttpBoardStore(fetchFn);
      await expect(store.load("demo")).rejects.toThrow();
      await expect(store.listBoards()).rejects.toThrow();
      expect(store.state("demo").errors.map(({ operation }) => operation)).toEqual([
        "load",
        "list",
      ]);
    }
  });
});

describe("HttpBoardStore writes", () => {
  it("PUTs and DELETEs each kind at its own address", async () => {
    const server = new FakeServer();
    const store = new HttpBoardStore(server.fetch);
    store.saveDrawing("demo", stored);
    store.saveNote("demo", note);
    store.saveRule("demo", rule);
    await store.whenIdle();
    store.deleteDrawing("demo", stored.drawing.id);
    store.deleteNote("demo", note.id);
    store.deleteRule("demo", rule.id);
    await store.whenIdle();
    expect(server.calls).toEqual([
      { method: "PUT", path: "/api/boards/demo/drawings/drawing-1", body: stored },
      { method: "PUT", path: "/api/boards/demo/notes/note%201", body: note },
      { method: "PUT", path: "/api/boards/demo/rules/rule-1", body: rule },
      { method: "DELETE", path: "/api/boards/demo/drawings/drawing-1", body: undefined },
      { method: "DELETE", path: "/api/boards/demo/notes/note%201", body: undefined },
      { method: "DELETE", path: "/api/boards/demo/rules/rule-1", body: undefined },
    ]);
  });

  it("never lets a delete overtake the save before it, while other entities carry on", async () => {
    const server = new FakeServer();
    const store = new HttpBoardStore(server.fetch);
    server.holdNext("drawings/drawing-1");
    store.saveDrawing("demo", stored);
    store.deleteDrawing("demo", stored.drawing.id);
    store.saveNote("demo", note);
    await vi.waitFor(() => expect(server.calls.map(({ method }) => method)).toEqual(["PUT"]));
    expect(server.calls[0]?.path).toContain("notes");

    server.release("drawings/drawing-1");
    await store.whenIdle();
    expect(server.calls.map(({ method, path }) => `${method} ${path.split("/").at(-2)}`)).toEqual([
      "PUT notes",
      "PUT drawings",
      "DELETE drawings",
    ]);
  });

  it("clears a board after the writes before it and before the writes after it", async () => {
    const server = new FakeServer();
    const store = new HttpBoardStore(server.fetch);
    server.holdNext("drawings/drawing-1");
    store.saveDrawing("demo", stored);
    store.clear("demo");
    store.saveNote("demo", note);
    store.saveNote("elsewhere", note);
    await vi.waitFor(() => expect(server.calls).toHaveLength(1));
    expect(server.calls[0]?.path).toBe("/api/boards/elsewhere/notes/note%201");

    server.release("drawings/drawing-1");
    await store.whenIdle();
    expect(server.calls.slice(1).map(({ method, path }) => `${method} ${path}`)).toEqual([
      "PUT /api/boards/demo/drawings/drawing-1",
      "DELETE /api/boards/demo",
      "PUT /api/boards/demo/notes/note%201",
    ]);
  });

  it("sends what the entity was when it was saved", async () => {
    const server = new FakeServer();
    const store = new HttpBoardStore(server.fetch);
    const changing = { ...note, text: "before" };
    store.saveNote("demo", changing);
    changing.text = "after";
    await store.whenIdle();
    expect(server.calls[0]?.body).toMatchObject({ text: "before" });
  });

  it("keeps the latest writes when offline without interrupting drawing, warning only once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new HttpBoardStore(offline);
    expect(() => {
      store.saveDrawing("demo", stored);
      store.deleteNote("demo", note.id);
      store.clear("demo");
      store.saveRule("demo", rule);
    }).not.toThrow();
    await store.whenIdle();
    await store.load("demo");
    expect(store.state("demo").unsaved).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats a refusal from the server like any other failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new HttpBoardStore(async () => new Response("bad", { status: 400 }));
    store.saveNote("demo", note);
    store.saveNote("demo", note);
    await store.whenIdle();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
