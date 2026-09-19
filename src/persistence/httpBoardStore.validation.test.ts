import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  noteSchema as serverNoteSchema,
  ruleSchema as serverRuleSchema,
} from "../../server/schemas";
import { BoardResponseError } from "./boardResponse";
import { HttpBoardStore } from "./httpBoardStore";
import { noteSchema, ruleSchema } from "./schemas";

const drawing = { id: "drawing", strokes: [[{ x: 1, y: 2 }]], cost: 3 };
const ruling = { name: "rock", nature: "heavy", strength: 1, tags: [], line: "Heavy." };
const stored = { drawing, ruling };
const note = {
  id: "note",
  author: "player",
  text: "g = moon",
  position: { x: 0, y: 0 },
  tone: "understood",
  createdAt: 1,
  fleeting: false,
};
const rule = {
  id: "rule",
  effect: { governs: "gravity", x: 0, y: 0.165 },
  explanation: "Moon gravity",
  sourceText: note.text,
  noteId: note.id,
  position: note.position,
  createdAt: 1,
};
const snapshot = { drawings: [stored], notes: [note], rules: [rule] };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("nested saved board validation", () => {
  it.each([
    ["top-level arrays", { ...snapshot, drawings: "lots" }],
    ["null drawing", { ...snapshot, drawings: [null] }],
    ["missing ruling", { ...snapshot, drawings: [{ drawing }] }],
    ["empty id", { ...snapshot, drawings: [{ ...stored, drawing: { ...drawing, id: "" } }] }],
    [
      "invalid strokes",
      { ...snapshot, drawings: [{ ...stored, drawing: { ...drawing, strokes: [[null]] } }] },
    ],
    [
      "negative cost",
      { ...snapshot, drawings: [{ ...stored, drawing: { ...drawing, cost: -1 } }] },
    ],
    [
      "unknown nature",
      { ...snapshot, drawings: [{ ...stored, ruling: { ...ruling, nature: "alien" } }] },
    ],
    [
      "invalid strength",
      { ...snapshot, drawings: [{ ...stored, ruling: { ...ruling, strength: "huge" } }] },
    ],
    ["invalid tags", { ...snapshot, drawings: [{ ...stored, ruling: { ...ruling, tags: [42] } }] }],
    ["null note", { ...snapshot, notes: [null] }],
    ["unknown author", { ...snapshot, notes: [{ ...note, author: "alice" }] }],
    ["unknown tone", { ...snapshot, notes: [{ ...note, tone: "alien" }] }],
    ["null position", { ...snapshot, notes: [{ ...note, position: null }] }],
    ["invalid timestamp", { ...snapshot, notes: [{ ...note, createdAt: "yesterday" }] }],
    ["unknown action", { ...snapshot, notes: [{ ...note, action: { type: "erase-world" } }] }],
    [
      "invalid action id",
      {
        ...snapshot,
        notes: [{ ...note, action: { type: "name-drawing", drawingId: "", name: "rock" } }],
      },
    ],
    ["null rule", { ...snapshot, rules: [null] }],
    [
      "unknown effect",
      { ...snapshot, rules: [{ ...rule, effect: { governs: "reality", value: 0 } }] },
    ],
    [
      "incomplete vector",
      { ...snapshot, rules: [{ ...rule, effect: { governs: "gravity", x: 1 } }] },
    ],
    [
      "invalid scalar",
      { ...snapshot, rules: [{ ...rule, effect: { governs: "clones", value: "two" } }] },
    ],
    ["invalid note id", { ...snapshot, rules: [{ ...rule, noteId: 7 }] }],
    ["duplicate drawing id", { ...snapshot, drawings: [stored, stored] }],
    ["duplicate note id", { ...snapshot, notes: [note, note] }],
    ["duplicate rule id", { ...snapshot, rules: [rule, rule] }],
  ])("rejects the entire load for %s without writing to the server", async (_label, body) => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => Response.json(body));
    const store = new HttpBoardStore(fetch);
    await expect(store.load("my board")).rejects.toMatchObject({
      name: "BoardResponseError",
      path: "/api/boards/my%20board",
      problems: expect.arrayContaining([expect.any(String)]),
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("nothing was restored or deleted"),
      expect.any(BoardResponseError),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/boards/my%20board");
    expect(fetch.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("accepts historic optional fields and preserves additive entity metadata", async () => {
    const compatible = {
      ...snapshot,
      notes: [{ ...note, metadata: { version: 2 } }],
      drawings: [{ ...stored, ruling: null, savedBy: "old-client" }],
    };
    const store = new HttpBoardStore(async () => Response.json(compatible));
    expect(await store.load("demo")).toEqual(compatible);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("shares the server's entity contracts rather than a second predicate", () => {
    expect(serverNoteSchema).toBe(noteSchema);
    expect(serverRuleSchema).toBe(ruleSchema);
  });

  it("can load again after a malformed response", async () => {
    let malformed = true;
    const store = new HttpBoardStore(async () =>
      Response.json(malformed ? { ...snapshot, drawings: [null] } : snapshot),
    );
    await expect(store.load("demo")).rejects.toBeInstanceOf(BoardResponseError);
    malformed = false;
    expect(await store.load("demo")).toEqual(snapshot);
  });
});

describe("nested board summary validation", () => {
  it.each([
    null,
    {},
    { id: "", drawings: 0, rules: 0 },
    { id: "x".repeat(201), drawings: 0, rules: 0 },
    { id: "demo", drawings: -1, rules: 0 },
    { id: "demo", drawings: 0.5, rules: 0 },
    { id: "demo", drawings: 0, rules: "one" },
    { id: "demo", drawings: 0, rules: -1 },
    { id: "demo", drawings: 0, rules: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects an invalid entry: %j", async (entry) => {
    const store = new HttpBoardStore(async () => Response.json({ boards: [entry] }));
    await expect(store.listBoards()).rejects.toBeInstanceOf(BoardResponseError);
  });

  it("accepts zero counts and ignores additive summary metadata", async () => {
    const store = new HttpBoardStore(async () =>
      Response.json({ boards: [{ id: "demo", drawings: 0, rules: 0, label: "extra" }] }),
    );
    expect(await store.listBoards()).toEqual([{ id: "demo", drawings: 0, rules: 0 }]);
  });
});
