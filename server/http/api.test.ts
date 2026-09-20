// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Ruling } from "../../src/cat/types";
import type { Stroke } from "../../src/core/geometry";
import type { DrawingId } from "../../src/ink/types";
import type { Note, NoteId } from "../../src/notes/types";
import type { BoardSnapshot, StoredDrawing } from "../../src/persistence/types";
import type { Rule, RuleId } from "../../src/rules/types";
import { createBeautifier } from "../beautify/beautifier";
import { InMemoryControllerHub, STALE_AFTER_MS } from "../controllers/hub";
import { readEvents } from "../controllers/testing/eventReader";
import { ManualClock } from "../controllers/testing/manualClock";
import { BoardRepository } from "../db/boardRepository";
import type { DatabaseConnection } from "../db/connect";
import { computeFeature } from "../quickdraw/feature";
import { QuickdrawRecognizer } from "../quickdraw/recognizer";
import type { Reading } from "../recognition/types";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import { circleSketch, lineSketch } from "../testing/sketches";
import { type ApiDependencies, createApi, type RankOptions, type SketchRecognizer } from "./api";
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

const PRETTIER = [
  [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
];

let connection: DatabaseConnection;
let api: Router;
let apiParts: () => Omit<ApiDependencies, "beautifier">;
let beautifier: ApiDependencies["beautifier"];
let clock: ManualClock;
let controllers: InMemoryControllerHub;

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
  const nearestNeighbours = new QuickdrawRecognizer(
    Array.from({ length: 8 }, (_, index) => [
      { category: "circle", feature: computeFeature(circleSketch({ x: 0, y: 0 }, 30 + index)) },
      {
        category: "line",
        feature: computeFeature(lineSketch({ x: 0, y: index }, { x: 300, y: index * 2 })),
      },
    ]).flat(),
  );
  const recognizer: SketchRecognizer = {
    read: async (strokes) => nearestNeighbours.read(strokes),
  };
  const compiler = {
    compile: async (text: string) => (text.includes("mars") ? MARS_RULE : null),
  };
  const transcriber = {
    transcribe: async (strokes: readonly Stroke[]) => (strokes.length > 1 ? "no gravity" : null),
    warmUp: async () => true,
  };
  beautifier = createBeautifier("http://beautifier.test/beautify", async (_url, init) => {
    const { name } = JSON.parse(String(init?.body)) as { name: string };
    return name === "a storm"
      ? new Response("model fell over", { status: 500 })
      : Response.json({ strokes: PRETTIER });
  });
  clock = new ManualClock();
  controllers = new InMemoryControllerHub(clock);
  const sketches = {
    categories: ["rabbit", "hot air balloon"],
    pick: async (category: string) =>
      category === "rabbit"
        ? { category, strokes: lineSketch({ x: 0, y: 0 }, { x: 9, y: 9 }) }
        : null,
    describe: () => "summoning: two sketches",
  };
  apiParts = () => ({ boards, recognizer, compiler, controllers, transcriber, sketches });
  api = createApi({ ...apiParts(), beautifier });
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
    [
      "a negative clone count",
      "rules/rule-1",
      { ...moonRule, effect: { governs: "clones", value: -1 } },
    ],
    [
      "a fractional clone count",
      "rules/rule-1",
      { ...moonRule, effect: { governs: "clones", value: 1.5 } },
    ],
    [
      "an excessive clone count",
      "rules/rule-1",
      { ...moonRule, effect: { governs: "clones", value: 1000 } },
    ],
    [
      "zero Alice size",
      "rules/rule-1",
      { ...moonRule, effect: { governs: "aliceSize", value: 0 } },
    ],
    [
      "an ink eater value outside its domain",
      "rules/rule-1",
      { ...moonRule, effect: { governs: "inkEater", value: 2 } },
    ],
    [
      "a ruling strength outside its domain",
      "drawings/drawing-1",
      storedDrawing("drawing-1", { ...MUSHROOM_RULING, strength: -1 }),
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

describe("beautify", () => {
  const strokes = circleSketch({ x: 0, y: 0 }, 40);

  it("carries the sketch to the attached model and its answer back", async () => {
    const response = await call("POST", "/api/beautify", { strokes, name: "a mushroom" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ strokes: PRETTIER });
  });

  it("says so plainly when the model fails, or when none is attached", async () => {
    expect((await call("POST", "/api/beautify", { strokes, name: "a storm" })).status).toBe(501);
    const bare = createApi({ ...apiParts(), beautifier: createBeautifier(null) });
    const response = await bare.handle(
      new Request("http://kami.test/api/beautify", {
        method: "POST",
        body: JSON.stringify({ strokes, name: "a mushroom" }),
      }),
    );
    expect(response.status).toBe(501);
  });

  it("rejects a sketch with no name", async () => {
    expect((await call("POST", "/api/beautify", { strokes, name: " " })).status).toBe(400);
  });
});

describe("transcribe", () => {
  const words = [
    ...lineSketch({ x: 0, y: 0 }, { x: 0, y: 40 }),
    ...lineSketch({ x: 0, y: 20 }, { x: 20, y: 20 }),
  ];

  it("answers with the words the reader saw, or null for a drawing", async () => {
    const read = await call("POST", "/api/transcribe", { strokes: words });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ text: "no gravity" });
    const drawn = await call("POST", "/api/transcribe", { strokes: [words[0]] });
    expect(await drawn.json()).toEqual({ text: null });
  });

  it("rejects no strokes, and says so when no reader is attached", async () => {
    expect((await call("POST", "/api/transcribe", { strokes: [] })).status).toBe(400);
    expect((await call("POST", "/api/transcribe", { text: "hi" })).status).toBe(400);
    const bare = createApi({ ...apiParts(), beautifier, transcriber: null });
    const response = await bare.handle(
      new Request("http://kami.test/api/transcribe", {
        method: "POST",
        body: JSON.stringify({ strokes: words }),
      }),
    );
    expect(response.status).toBe(501);
  });
});

describe("sketches", () => {
  it("lists what can be summoned and hands out a drawing by name", async () => {
    const listed = await call("GET", "/api/sketches");
    expect(await listed.json()).toEqual({ categories: ["rabbit", "hot air balloon"] });
    const rabbit = await call("GET", "/api/sketches/rabbit");
    expect(rabbit.status).toBe(200);
    expect(await rabbit.json()).toEqual({
      category: "rabbit",
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 9, y: 9 },
        ],
      ],
    });
  });

  it("has no drawing of an unknown thing, and none at all without a library", async () => {
    expect((await call("GET", "/api/sketches/hot%20air%20balloon")).status).toBe(404);
    expect((await call("GET", "/api/sketches/unicorn")).status).toBe(404);
    const bare = createApi({ ...apiParts(), beautifier, sketches: null });
    const listed = await bare.handle(new Request("http://kami.test/api/sketches"));
    expect(await listed.json()).toEqual({ categories: [] });
    const rabbit = await bare.handle(new Request("http://kami.test/api/sketches/rabbit"));
    expect(rabbit.status).toBe(404);
  });
});

describe("recognise and compile", () => {
  it("says how sure it is, and accepts a drawing still under the pen", async () => {
    const strokes = circleSketch({ x: 5200, y: -340 }, 85, 0.02);
    const response = await call("POST", "/api/recognize", { strokes, partial: true });
    const { guesses, confidence } = (await response.json()) as {
      guesses: string[];
      confidence: number[];
    };
    expect(confidence).toHaveLength(guesses.length);
    expect(confidence[0]).toBeGreaterThan(0.5);
    expect(confidence[0]).toBeLessThanOrEqual(1);
  });

  it("recognises a player's sketch in world px", async () => {
    const strokes = circleSketch({ x: 5200, y: -340 }, 85, 0.02);
    const response = await call("POST", "/api/recognize", { strokes });
    expect(response.status).toBe(200);
    const { guesses } = (await response.json()) as { guesses: string[] };
    expect(guesses[0]).toBe("circle");
  });

  it("says what each guess is called, what it would do, and what Kami makes of it", async () => {
    const strokes = circleSketch({ x: 5200, y: -340 }, 85, 0.02);
    const recognition = (await (await call("POST", "/api/recognize", { strokes })).json()) as {
      guesses: string[];
      names: string[];
      natures: string[];
      strengths: number[];
      lines: string[];
    };
    expect(recognition.names[0]).toBe("a circle");
    expect(recognition.natures[0]).toBe("ink");
    expect(recognition.strengths[0]).toBe(1);
    for (const field of ["names", "natures", "strengths", "lines"] as const) {
      expect(recognition[field]).toHaveLength(recognition.guesses.length);
    }
  });

  it("folds aliases into one guess, keeps the best three, and passes the pen's state on", async () => {
    const asked: RankOptions[] = [];
    const scripted: SketchRecognizer = {
      read: async (_strokes, options = {}) => {
        asked.push(options);
        return {
          ranking: [
            { category: "birthday cake", confidence: 0.4 },
            { category: "cake", confidence: 0.3 },
            { category: "mushroom", confidence: 0.2 },
            { category: "door", confidence: 0.06 },
            { category: "ladder", confidence: 0.04 },
          ],
          certainAbove: null,
        };
      },
    };
    const eyes = createApi({ ...apiParts(), recognizer: scripted, beautifier });
    const response = await eyes.handle(
      new Request(`${ORIGIN}/api/recognize`, {
        method: "POST",
        body: JSON.stringify({ strokes: circleSketch({ x: 0, y: 0 }, 40), partial: true }),
      }),
    );
    expect(asked).toEqual([{ partial: true }]);
    expect(await response.json()).toMatchObject({
      guesses: ["cake", "mushroom", "door"],
      confidence: [0.7, 0.2, 0.06],
      names: ["a cake", "a mushroom", "a door"],
      natures: ["grow", "bouncy", "goal"],
    });
  });

  describe("naming without asking", () => {
    interface Recognition {
      readonly guesses: readonly string[];
      readonly confidence: readonly number[];
      readonly certain: boolean;
    }

    const recognitionOf = async (reading: Reading): Promise<Recognition> => {
      const eyes = createApi({
        ...apiParts(),
        recognizer: { read: async () => reading },
        beautifier,
      });
      const response = await eyes.handle(
        new Request(`${ORIGIN}/api/recognize`, {
          method: "POST",
          body: JSON.stringify({ strokes: circleSketch({ x: 0, y: 0 }, 40) }),
        }),
      );
      return (await response.json()) as Recognition;
    };

    const cakeAt = (confidence: number): Reading["ranking"] => [
      { category: "cake", confidence },
      { category: "mushroom", confidence: 0.1 },
    ];

    it("is certain when the leader reaches the floor its recogniser set", async () => {
      expect(await recognitionOf({ ranking: cakeAt(0.8), certainAbove: 0.8 })).toMatchObject({
        guesses: ["cake", "mushroom"],
        certain: true,
      });
      expect((await recognitionOf({ ranking: cakeAt(0.85), certainAbove: 0.8 })).certain).toBe(
        true,
      );
    });

    it("is not certain just under the floor, even when the rounded confidence reads the same", async () => {
      expect(await recognitionOf({ ranking: cakeAt(0.7996), certainAbove: 0.8 })).toMatchObject({
        confidence: [0.8, 0.1],
        certain: false,
      });
    });

    it("is never certain when the recogniser's confidence cannot be trusted", async () => {
      expect((await recognitionOf({ ranking: cakeAt(1), certainAbove: null })).certain).toBe(false);
    });

    it("decides on the leader after aliases are folded together", async () => {
      const split: Reading["ranking"] = [
        { category: "mushroom", confidence: 0.3 },
        { category: "birthday cake", confidence: 0.28 },
        { category: "cake", confidence: 0.27 },
      ];
      expect(await recognitionOf({ ranking: split, certainAbove: 0.5 })).toMatchObject({
        guesses: ["cake", "mushroom"],
        confidence: [0.55, 0.3],
        certain: true,
      });
      expect((await recognitionOf({ ranking: split, certainAbove: 0.6 })).certain).toBe(false);
    });

    it("is not certain of an empty answer, whatever the floor", async () => {
      expect(await recognitionOf({ ranking: [], certainAbove: 0 })).toEqual({
        guesses: [],
        confidence: [],
        names: [],
        natures: [],
        strengths: [],
        lines: [],
        certain: false,
      });
    });

    it("names the circle the k-NN is sure of", async () => {
      const strokes = circleSketch({ x: 5200, y: -340 }, 85, 0.02);
      const response = await call("POST", "/api/recognize", { strokes });
      expect(await response.json()).toMatchObject({ guesses: ["circle"], certain: true });
    });
  });

  it("returns the compiler's rule, or null when it has none", async () => {
    const understood = await call("POST", "/api/compile", { text: "gravity like mars" });
    expect(await understood.json()).toEqual({ rule: MARS_RULE });
    const shrug = await call("POST", "/api/compile", { text: "a mushroom" });
    expect(await shrug.json()).toEqual({ rule: null });
  });
});

describe("controllers", () => {
  const AT_REST = { x: 0, y: 0, held: [], buttons: [] };

  const say = (controller: string, body: string): Promise<Response> =>
    api.handle(
      new Request(`${ORIGIN}/api/controllers/${controller}/state`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
      }),
    );

  it("takes a stick's state over HTTP and lists who is connected", async () => {
    const response = await say("desk", "100 0 A");
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    clock.advance(120);
    const listed = await call("GET", "/api/controllers");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toContainEqual({
      id: "desk",
      x: 1,
      y: 0,
      held: ["right", "up"],
      buttons: ["a"],
      transport: "http",
      idleMs: 120,
    });
  });

  it("reads the body whatever curl calls it", async () => {
    const response = await api.handle(
      new Request(`${ORIGIN}/api/controllers/curl/state`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "-100 0",
      }),
    );
    expect(response.status).toBe(204);
    expect((await (await call("GET", "/api/controllers")).json()) as unknown[]).toContainEqual(
      expect.objectContaining({ id: "curl", held: ["left"] }),
    );
  });

  it.each([
    ["no body", "arcade", ""],
    ["words for axes", "arcade", "fast 0"],
    ["one axis", "arcade", "100"],
    ["JSON", "arcade", '{"x":100,"y":0}'],
    ["a controller name outside a-z, 0-9 and '-'", "Arcade_1", "100 0"],
  ])("answers 400 to %s", async (_what, controller, body) => {
    const response = await say(controller, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
    expect((await (await call("GET", "/api/controllers")).json()) as unknown[]).not.toContainEqual(
      expect.objectContaining({ id: controller }),
    );
  });

  it("streams the state on connect, then every change, then the release when the stick goes quiet", async () => {
    const response = await call("GET", "/api/controllers/arcade/events");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const events = readEvents(response);
    expect(await events.nextEvent()).toEqual(AT_REST);

    await say("arcade", "-70 85 A");
    expect(await events.nextEvent()).toEqual({
      x: -0.7,
      y: 0.85,
      held: ["left", "up"],
      buttons: ["a"],
    });

    await say("arcade", "-70 85 A");
    await say("other", "100 0");
    await say("arcade", "0 -100");
    expect(await events.nextEvent()).toEqual({ x: 0, y: -1, held: ["down"], buttons: [] });

    clock.advance(STALE_AFTER_MS);
    expect(await events.nextEvent()).toEqual(AT_REST);
    await events.cancel();
  });

  it("hands a late subscriber what is held right now", async () => {
    await say("late", "0 100");
    const events = readEvents(await call("GET", "/api/controllers/late/events"));
    expect(await events.nextEvent()).toEqual({ x: 0, y: 1, held: ["up"], buttons: [] });
    await events.cancel();
  });

  it("answers 400 to events for a name no controller can have", async () => {
    expect((await call("GET", "/api/controllers/NOT%20A%20NAME/events")).status).toBe(400);
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
