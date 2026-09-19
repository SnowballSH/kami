// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Ruling } from "../../src/cat/types";
import type { DrawingId } from "../../src/ink/types";
import type { Note, NoteId } from "../../src/notes/types";
import type { BoardSnapshot, StoredDrawing } from "../../src/persistence/types";
import type { Rule, RuleId } from "../../src/rules/types";
import { BoardRepository } from "../db/boardRepository";
import type { DatabaseConnection } from "../db/connect";
import { computeFeature } from "../quickdraw/feature";
import { QuickdrawRecognizer } from "../quickdraw/recognizer";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import { circleSketch, lineSketch } from "../testing/sketches";
import { createApi } from "./api";
import type { Router } from "./router";

const ORIGIN = "http://kami.test";

const MUSHROOM_RULING: Ruling = {
  name: "a bouncy mushroom",
  nature: "bouncy",
  strength: 1,
  tags: [],
  line: "A mushroom. Springy.",
};

const storedDrawing = (id: string, ruling: Ruling | null = null): StoredDrawing => ({
  drawing: {
    id: id as DrawingId,
    strokes: [
      [
        { x: 0, y: 0 },
        { x: 40.5, y: -12 },
      ],
    ],
    cost: 42.2,
  },
  ruling,
});

const note = (id: string, text: string, createdAt: number): Note => ({
  id: id as NoteId,
  author: "player",
  text,
  position: { x: 10, y: 20 },
  tone: "understood",
  createdAt,
  fleeting: false,
});

const moonRule: Rule = {
  id: "rule-1" as RuleId,
  effect: { governs: "gravity", x: 0, y: 0.165 },
  explanation: "gravity = 0.17 g (the Moon)",
  sourceText: "g = the moon's gravity",
  noteId: "note-1" as NoteId,
  position: { x: 10, y: 20 },
  createdAt: 5,
};

const MARS_RULE = { effect: { governs: "gravity", x: 0, y: 0.38 }, explanation: "Mars" } as const;

let connection: DatabaseConnection;
let api: Router;

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  api.handle(
    new Request(`${ORIGIN}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: typeof body === "string" ? body : JSON.stringify(body),
          }),
    }),
  );

const loadBoard = async (boardId: string): Promise<BoardSnapshot> =>
  (await call("GET", `/api/boards/${boardId}`)).json() as Promise<BoardSnapshot>;

beforeAll(async () => {
  connection = await startMemoryDatabase();
  const boards = new BoardRepository(connection.db);
  await boards.ensureIndexes();
  const recognizer = new QuickdrawRecognizer(
    Array.from({ length: 8 }, (_, index) => [
      { category: "circle", feature: computeFeature(circleSketch({ x: 0, y: 0 }, 30 + index)) },
      {
        category: "line",
        feature: computeFeature(lineSketch({ x: 0, y: index }, { x: 300, y: index * 2 })),
      },
    ]).flat(),
  );
  const compiler = {
    compile: async (text: string) => (text.includes("mars") ? MARS_RULE : null),
  };
  api = createApi({ boards, recognizer, compiler });
}, 120_000);

afterAll(async () => {
  await connection.close();
});

beforeEach(async () => {
  await connection.db.dropDatabase();
  await new BoardRepository(connection.db).ensureIndexes();
});

describe("board memory", () => {
  it("answers an unknown board with an empty snapshot", async () => {
    expect(await loadBoard("nowhere")).toEqual({ drawings: [], notes: [], rules: [] });
  });

  it("gives back exactly what was saved, without storage fields", async () => {
    const stored = storedDrawing("drawing-1", MUSHROOM_RULING);
    const written = note("note-1", "g = the moon's gravity", 5);
    expect((await call("PUT", "/api/boards/demo/drawings/drawing-1", stored)).status).toBe(200);
    expect((await call("PUT", "/api/boards/demo/notes/note-1", written)).status).toBe(200);
    expect((await call("PUT", "/api/boards/demo/rules/rule-1", moonRule)).status).toBe(200);

    expect(await loadBoard("demo")).toEqual({
      drawings: [stored],
      notes: [written],
      rules: [moonRule],
    });
  });

  it("keeps a note's tap action", async () => {
    const guess: Note = {
      ...note("note-9", "a mushroom?", 9),
      author: "kami",
      action: { type: "name-drawing", drawingId: "drawing-1" as DrawingId, name: "a mushroom" },
    };
    await call("PUT", "/api/boards/demo/notes/note-9", guess);
    expect((await loadBoard("demo")).notes).toEqual([guess]);
  });

  it("overwrites on a second save of the same id", async () => {
    await call("PUT", "/api/boards/demo/drawings/drawing-1", storedDrawing("drawing-1"));
    await call(
      "PUT",
      "/api/boards/demo/drawings/drawing-1",
      storedDrawing("drawing-1", MUSHROOM_RULING),
    );
    const { drawings } = await loadBoard("demo");
    expect(drawings).toHaveLength(1);
    expect(drawings[0]?.ruling).toEqual(MUSHROOM_RULING);
  });

  it("keeps boards apart and returns notes oldest first", async () => {
    await call("PUT", "/api/boards/demo/notes/late", note("late", "second", 20));
    await call("PUT", "/api/boards/demo/notes/early", note("early", "first", 10));
    await call("PUT", "/api/boards/other/notes/early", note("early", "elsewhere", 1));
    expect((await loadBoard("demo")).notes.map(({ text }) => text)).toEqual(["first", "second"]);
    expect((await loadBoard("other")).notes.map(({ text }) => text)).toEqual(["elsewhere"]);
  });

  it("deletes one document and leaves the rest", async () => {
    await call("PUT", "/api/boards/demo/drawings/drawing-1", storedDrawing("drawing-1"));
    await call("PUT", "/api/boards/demo/drawings/drawing-2", storedDrawing("drawing-2"));
    expect((await call("DELETE", "/api/boards/demo/drawings/drawing-1")).status).toBe(200);
    expect((await call("DELETE", "/api/boards/demo/drawings/never-existed")).status).toBe(200);
    expect((await loadBoard("demo")).drawings.map(({ drawing }) => drawing.id)).toEqual([
      "drawing-2",
    ]);
  });

  it("clears one board only", async () => {
    await call("PUT", "/api/boards/demo/drawings/drawing-1", storedDrawing("drawing-1"));
    await call("PUT", "/api/boards/demo/rules/rule-1", moonRule);
    await call("PUT", "/api/boards/other/drawings/drawing-1", storedDrawing("drawing-1"));
    expect((await call("DELETE", "/api/boards/demo")).status).toBe(200);
    expect(await loadBoard("demo")).toEqual({ drawings: [], notes: [], rules: [] });
    expect((await loadBoard("other")).drawings).toHaveLength(1);
  });

  it("summarises every board that has anything on it", async () => {
    await call("PUT", "/api/boards/demo/drawings/drawing-1", storedDrawing("drawing-1"));
    await call("PUT", "/api/boards/demo/drawings/drawing-2", storedDrawing("drawing-2"));
    await call("PUT", "/api/boards/demo/rules/rule-1", moonRule);
    await call("PUT", "/api/boards/my%20game/notes/note-1", note("note-1", "hello", 1));
    expect(await (await call("GET", "/api/boards")).json()).toEqual({
      boards: [
        { id: "demo", drawings: 2, rules: 1 },
        { id: "my game", drawings: 0, rules: 0 },
      ],
    });
  });
});

describe("bad requests", () => {
  it.each([
    ["a drawing with no strokes field", "drawings/drawing-1", { drawing: { id: "drawing-1" } }],
    [
      "an unknown nature",
      "drawings/drawing-1",
      storedDrawing("drawing-1", { ...MUSHROOM_RULING, nature: "sparkly" as Ruling["nature"] }),
    ],
    ["a note with a bad tone", "notes/note-1", { ...note("note-1", "x", 1), tone: "angry" }],
    [
      "a rule with an unknown effect",
      "rules/rule-1",
      { ...moonRule, effect: { governs: "magnetism", value: 2 } },
    ],
    ["an id that differs from the path", "notes/note-1", note("note-2", "x", 1)],
    ["a body that is not JSON", "notes/note-1", "{not json"],
  ])("answers 400 to %s", async (_what, path, body) => {
    const response = await call("PUT", `/api/boards/demo/${path}`, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect(await loadBoard("demo")).toEqual({ drawings: [], notes: [], rules: [] });
  });

  it("answers 400 to bad recognise and compile payloads", async () => {
    expect((await call("POST", "/api/recognize", { strokes: "scribble" })).status).toBe(400);
    expect((await call("POST", "/api/recognize", { strokes: [[{ x: "1", y: 2 }]] })).status).toBe(
      400,
    );
    expect((await call("POST", "/api/compile", { text: 7 })).status).toBe(400);
    expect((await call("POST", "/api/compile")).status).toBe(400);
  });

  it("answers 404 to unknown routes and collections, 400 to a malformed path", async () => {
    expect((await call("GET", "/api/nothing")).status).toBe(404);
    expect((await call("PUT", "/api/boards/demo/doodles/x", {})).status).toBe(404);
    expect((await call("GET", "/api/boards/%E0%A4%A")).status).toBe(400);
  });
});

describe("recognise and compile", () => {
  it("recognises a player's sketch in world px", async () => {
    const strokes = circleSketch({ x: 5200, y: -340 }, 85, 0.02);
    const response = await call("POST", "/api/recognize", { strokes });
    expect(response.status).toBe(200);
    const { guesses } = (await response.json()) as { guesses: string[] };
    expect(guesses[0]).toBe("circle");
  });

  it("returns the compiler's rule, or null when it has none", async () => {
    const understood = await call("POST", "/api/compile", { text: "gravity like mars" });
    expect(await understood.json()).toEqual({ rule: MARS_RULE });
    const shrug = await call("POST", "/api/compile", { text: "a mushroom" });
    expect(await shrug.json()).toEqual({ rule: null });
  });
});

describe("CORS", () => {
  it("answers preflights and marks responses as readable from any origin", async () => {
    const preflight = await call("OPTIONS", "/api/boards/demo/notes/note-1");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");
    expect((await call("GET", "/api/boards")).headers.get("access-control-allow-origin")).toBe("*");
  });
});
