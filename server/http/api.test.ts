// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ruling } from "../../src/cat/types";
import type { Stroke } from "../../src/core/geometry";
import { INPUT_LIMITS } from "../../src/core/inputLimits";
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
import { BoardFeed } from "../sync/boardFeed";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import { circleSketch, lineSketch } from "../testing/sketches";
import { type ApiDependencies, createApi, type RankOptions, type SketchRecognizer } from "./api";
import type { Router } from "./router";

const ORIGIN = "http://kami.test";
const BOOT = "life";

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
const MARS_SCENE = {
  place: "Mars",
  laws: [MARS_RULE],
  props: [{ word: "cactus", at: { x: -200, y: -120 }, size: 1 }],
  line: "Red dust everywhere.",
} as const;

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

const readBoard = async (boardId: string): Promise<BoardSnapshot> =>
  (await call("GET", `/api/boards/${boardId}`)).json() as Promise<BoardSnapshot>;

const loadBoard = async (boardId: string): Promise<Omit<BoardSnapshot, "cursor">> => {
  const { drawings, notes, rules } = await readBoard(boardId);
  return { drawings, notes, rules };
};

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
  const scenes = {
    compile: async (text: string) => (text.includes("mars") ? MARS_SCENE : null),
  };
  const transcriber = {
    ready: true,
    transcribe: async (strokes: readonly Stroke[]) => (strokes.length > 1 ? "no gravity" : null),
    warmUp: async () => true,
  };
  beautifier = createBeautifier({ url: "http://beautifier.test/beautify" }, async (_url, init) => {
    const { name } = JSON.parse(String(init?.body)) as { name: string };
    return name === "a storm"
      ? new Response("model fell over", { status: 500 })
      : Response.json({ strokes: PRETTIER });
  });
  clock = new ManualClock();
  controllers = new InMemoryControllerHub(clock);
  apiParts = () => ({
    boards,
    recognizer,
    compiler,
    scenes,
    controllers,
    transcriber,
    feed: new BoardFeed({ boot: BOOT }),
  });
  api = createApi({ ...apiParts(), beautifier });
}, 120_000);

afterAll(async () => {
  await connection.close();
});

beforeEach(async () => {
  await connection.db.dropDatabase();
  await new BoardRepository(connection.db).ensureIndexes();
});

describe("input budgets", () => {
  const stroke = Array.from({ length: INPUT_LIMITS.pointsPerStroke }, () => ({ x: 0, y: 0 }));
  const excess = [stroke, stroke, [{ x: 0, y: 0 }]];

  it("rejects aggregate excess before recognition, transcription or beautification", async () => {
    const read = vi.fn(async () => ({ ranking: [], certainAbove: null }));
    const beautify = vi.fn(async () => null);
    const transcribe = vi.fn(async () => null);
    api = createApi({
      ...apiParts(),
      recognizer: { read },
      beautifier: { beautify },
      transcriber: { ready: true, transcribe, warmUp: async () => true },
    });
    for (const route of ["recognize", "transcribe", "beautify"]) {
      const response = await call("POST", `/api/${route}`, { strokes: excess });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("points per drawing");
    }
    expect(read).not.toHaveBeenCalled();
    expect(beautify).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    api = createApi({ ...apiParts(), beautifier });
  });

  it("accepts exact stored drawing/text boundaries and rejects excess without saving", async () => {
    const stored = storedDrawing("bounded");
    const drawing = { ...stored, drawing: { ...stored.drawing, strokes: [stroke, stroke] } };
    expect((await call("PUT", "/api/boards/demo/drawings/bounded", drawing)).status).toBe(200);
    expect(
      (
        await call("PUT", "/api/boards/demo/drawings/bounded", {
          ...drawing,
          drawing: { ...drawing.drawing, strokes: excess },
        })
      ).status,
    ).toBe(400);
    expect((await loadBoard("demo")).drawings[0]?.drawing.strokes).toHaveLength(2);
    expect(
      (
        await call(
          "PUT",
          "/api/boards/demo/notes/limit",
          note("limit", "x".repeat(INPUT_LIMITS.text), 1),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "PUT",
          "/api/boards/demo/notes/excess",
          note("excess", "x".repeat(INPUT_LIMITS.text + 1), 1),
        )
      ).status,
    ).toBe(400);
    expect((await loadBoard("demo")).notes).toHaveLength(1);
  });

  it.each([
    ["/api/recognize", INPUT_LIMITS.sketchBytes],
    ["/api/beautify", INPUT_LIMITS.sketchBytes],
    ["/api/transcribe", INPUT_LIMITS.sketchBytes],
    ["/api/compile", INPUT_LIMITS.textBytes],
    ["/api/scene", INPUT_LIMITS.textBytes],
    ["/api/controllers/pen/state", INPUT_LIMITS.controllerBytes],
  ])("rejects excessive bytes on %s before parsing", async (path, bytes) => {
    expect((await call("POST", path, " ".repeat(bytes + 1))).status).toBe(413);
  });
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

  it("round-trips drawing label associations alongside legacy notes", async () => {
    const stored = storedDrawing("drawing-1", MUSHROOM_RULING);
    const label: Note = {
      ...note("label", "a bouncy mushroom", 1),
      drawingId: stored.drawing.id,
    };
    const legacy = note("legacy", "old writing", 2);
    await call("PUT", "/api/boards/demo/drawings/drawing-1", stored);
    expect((await call("PUT", "/api/boards/demo/notes/label", label)).status).toBe(200);
    expect((await call("PUT", "/api/boards/demo/notes/legacy", legacy)).status).toBe(200);
    expect(await loadBoard("demo")).toEqual({
      drawings: [stored],
      notes: [label, legacy],
      rules: [],
    });
  });

  it.each(["", "x".repeat(201), null, 1, {}])(
    "rejects an invalid drawing label association: %j",
    async (drawingId) => {
      const response = await call("PUT", "/api/boards/demo/notes/label", {
        ...note("label", "a rock", 1),
        drawingId,
      });
      expect(response.status).toBe(400);
      expect((await loadBoard("demo")).notes).toEqual([]);
    },
  );

  it("validates an optional ruling on a guess action while keeping older actions readable", async () => {
    const action = {
      type: "name-drawing",
      drawingId: "drawing-1",
      name: MUSHROOM_RULING.name,
      ruling: MUSHROOM_RULING,
    };
    const guess = { ...note("note-9", "a mushroom?", 9), action };
    expect((await call("PUT", "/api/boards/demo/notes/note-9", guess)).status).toBe(200);
    expect((await loadBoard("demo")).notes).toEqual([guess]);
    const invalid = {
      ...guess,
      action: { ...action, ruling: { ...MUSHROOM_RULING, nature: "sparkly" } },
    };
    expect((await call("PUT", "/api/boards/demo/notes/note-9", invalid)).status).toBe(400);
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
    expect((await call("POST", "/api/scene", { text: 7 })).status).toBe(400);
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

describe("exemplar", () => {
  const RABBIT = {
    word: "rabbit",
    strokes: [
      [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ],
    ],
  };
  const drawing = () =>
    createApi({
      ...apiParts(),
      beautifier,
      exemplars: {
        categories: ["rabbit", "hot air balloon"],
        exemplar: async (word) => (word === "rabbit" ? RABBIT : null),
      },
    });

  it("lists every word it has a picture of, none without a source", async () => {
    const listed = await drawing().handle(new Request(`${ORIGIN}/api/exemplars`));
    expect(await listed.json()).toEqual({ categories: ["rabbit", "hot air balloon"] });
    expect(await (await call("GET", "/api/exemplars")).json()).toEqual({ categories: [] });
  });

  it("draws the word asked for", async () => {
    const response = await drawing().handle(new Request(`${ORIGIN}/api/exemplar?word=rabbit`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(RABBIT);
  });

  it("has no picture of a word it never learnt, and none at all without a source", async () => {
    const unknown = await drawing().handle(new Request(`${ORIGIN}/api/exemplar?word=unicorn`));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "no picture of unicorn" });
    expect((await call("GET", "/api/exemplar?word=rabbit")).status).toBe(404);
  });

  it("asks for a word when given none", async () => {
    expect((await call("GET", "/api/exemplar")).status).toBe(400);
    expect((await call("GET", "/api/exemplar?word=%20")).status).toBe(400);
  });
});

describe("transcribe", () => {
  const words = [
    ...lineSketch({ x: 0, y: 0 }, { x: 0, y: 40 }),
    ...lineSketch({ x: 0, y: 20 }, { x: 20, y: 20 }),
  ];

  it("fails closed before the configured reader passes its image check", async () => {
    let reads = 0;
    const transcriber = {
      ready: false,
      warmUp: async () => false,
      transcribe: async () => {
        reads += 1;
        return "hi";
      },
    };
    const guarded = createApi({ ...apiParts(), beautifier, transcriber });
    const request = () =>
      new Request("http://kami.test/api/transcribe", {
        method: "POST",
        body: JSON.stringify({ strokes: words }),
      });
    expect((await guarded.handle(request())).status).toBe(501);
    expect(reads).toBe(0);
    transcriber.ready = true;
    expect((await guarded.handle(request())).status).toBe(200);
    expect(reads).toBe(1);
  });

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

  it("returns the scene compiler's scene, or null when it knows no such place", async () => {
    const known = await call("POST", "/api/scene", { text: "take us to mars" });
    expect(await known.json()).toEqual({ scene: MARS_SCENE });
    const unknown = await call("POST", "/api/scene", { text: "take us to narnia" });
    expect(await unknown.json()).toEqual({ scene: null });
    expect((await call("POST", "/api/scene")).status).toBe(400);
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
  it("allows same-origin demo requests without exposing the API to arbitrary origins", async () => {
    const preflight = await api.handle(
      new Request(`${ORIGIN}/api/boards/demo/notes/note-1`, {
        method: "OPTIONS",
        headers: { origin: ORIGIN, "access-control-request-method": "PUT" },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect((await call("GET", "/api/boards")).headers.has("access-control-allow-origin")).toBe(
      false,
    );
    expect(
      (
        await api.handle(
          new Request(`${ORIGIN}/api/boards`, {
            headers: { origin: "https://untrusted.test" },
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("shared pages", () => {
  const GHOST = {
    center: { x: 12, y: -30 },
    velocity: { x: 1.5, y: 0 },
    width: 24,
    height: 48,
    size: "normal",
    sizeMultiplier: 1,
    innateScale: 1,
    scale: 1,
    headingScale: 1,
    facing: 1,
    walking: true,
    grounded: true,
    climbing: false,
    hasKey: false,
    ride: null,
    look: { kind: "alice" },
  } as const;

  it("tells every device on a board what the others save, delete and clear, numbered", async () => {
    const response = await call("GET", "/api/boards/together/events?peer=ipad");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const events = readEvents(response);
    expect(await events.nextEvent()).toEqual({ type: "cursor", seq: 0, boot: BOOT });

    await call("PUT", "/api/boards/together/drawings/d1", storedDrawing("d1"));
    await call("PUT", "/api/boards/elsewhere/drawings/d9", storedDrawing("d9"));
    await call("PUT", "/api/boards/together/rules/rule-1", moonRule);
    await call("DELETE", "/api/boards/together/drawings/d1");
    await call("DELETE", "/api/boards/together");

    expect(await events.nextEvent()).toEqual({
      seq: 1,
      type: "put",
      kind: "drawings",
      id: "d1",
      entity: storedDrawing("d1"),
    });
    expect(await events.nextEvent()).toEqual({
      seq: 2,
      type: "put",
      kind: "rules",
      id: "rule-1",
      entity: moonRule,
    });
    expect(await events.nextEvent()).toEqual({
      seq: 3,
      type: "delete",
      kind: "drawings",
      id: "d1",
    });
    expect(await events.nextEvent()).toEqual({ seq: 4, type: "clear" });
    await events.cancel();
  });

  it("carries the sequence number as the event id, and resumes from `since` or Last-Event-ID", async () => {
    await call("PUT", "/api/boards/resumed/notes/n1", note("n1", "one", 1));
    await call("PUT", "/api/boards/resumed/notes/n2", note("n2", "two", 2));
    const stream = readEvents(await call("GET", "/api/boards/resumed/events?since=1"));
    expect(await stream.nextBlock()).toBe("retry: 1000");
    expect(await stream.nextBlock()).toBe(
      `id: ${BOOT}:2\ndata: ${JSON.stringify({ type: "put", kind: "notes", id: "n2", entity: note("n2", "two", 2), seq: 2 })}`,
    );
    await stream.cancel();

    const reconnected = readEvents(
      await api.handle(
        new Request(`${ORIGIN}/api/boards/resumed/events`, { headers: { "last-event-id": "2" } }),
      ),
    );
    await call("PUT", "/api/boards/resumed/notes/n3", note("n3", "three", 3));
    expect(await reconnected.nextEvent()).toMatchObject({ seq: 3, id: "n3" });
    await reconnected.cancel();

    const lost = readEvents(await call("GET", "/api/boards/resumed/events?since=99"));
    expect(await lost.nextBlock()).toBe("retry: 1000");
    expect(await lost.nextBlock()).toBe(
      `id: ${BOOT}:3\ndata: ${JSON.stringify({ type: "resync", seq: 3, boot: BOOT })}`,
    );
    await lost.cancel();
  });

  it("numbers the opening cursor, so a reconnect before any change still resumes from it", async () => {
    await call("PUT", "/api/boards/quiet/notes/n1", note("n1", "one", 1));
    const opened = readEvents(await call("GET", "/api/boards/quiet/events"));
    expect(await opened.nextBlock()).toBe("retry: 1000");
    expect(await opened.nextBlock()).toBe(
      `id: ${BOOT}:1\ndata: ${JSON.stringify({ type: "cursor", seq: 1, boot: BOOT })}`,
    );
    await opened.cancel();

    await call("PUT", "/api/boards/quiet/notes/n2", note("n2", "two", 2));
    const reconnected = readEvents(
      await api.handle(
        new Request(`${ORIGIN}/api/boards/quiet/events`, {
          headers: { "last-event-id": `${BOOT}:1` },
        }),
      ),
    );
    expect(await reconnected.nextEvent()).toMatchObject({ type: "put", seq: 2, id: "n2" });
    await reconnected.cancel();
  });

  it("says with the board where its feed stood, so a device follows on from there", async () => {
    expect((await readBoard("cursored")).cursor).toEqual({ boot: BOOT, seq: 0 });
    await call("PUT", "/api/boards/cursored/notes/n1", note("n1", "one", 1));
    const { cursor, notes } = await readBoard("cursored");
    expect(cursor).toEqual({ boot: BOOT, seq: 1 });
    expect(notes).toHaveLength(1);
    await call("PUT", "/api/boards/cursored/notes/n2", note("n2", "two", 2));
    const resumed = readEvents(await call("GET", `/api/boards/cursored/events?since=${BOOT}:1`));
    expect(await resumed.nextEvent()).toMatchObject({ type: "put", seq: 2, id: "n2" });
    await resumed.cancel();
  });

  it("asks a device resuming from another life of the server to reload", async () => {
    await call("PUT", "/api/boards/reborn/notes/n1", note("n1", "one", 1));
    await call("PUT", "/api/boards/reborn/notes/n2", note("n2", "two", 2));
    const stale = readEvents(
      await api.handle(
        new Request(`${ORIGIN}/api/boards/reborn/events`, {
          headers: { "last-event-id": "longgone:1" },
        }),
      ),
    );
    expect(await stale.nextEvent()).toEqual({ type: "resync", seq: 2, boot: BOOT });
    await stale.cancel();
  });

  it("relays where each device's Alice is, and takes her off the page when its stream ends", async () => {
    const laptop = readEvents(await call("GET", "/api/boards/presence/events?peer=laptop"));
    expect(await laptop.nextEvent()).toEqual({ type: "cursor", seq: 0, boot: BOOT });

    const controller = new AbortController();
    const ipad = readEvents(
      await api.handle(
        new Request(`${ORIGIN}/api/boards/presence/events?peer=ipad`, {
          signal: controller.signal,
        }),
      ),
    );
    expect(await ipad.nextEvent()).toEqual({ type: "cursor", seq: 0, boot: BOOT });

    const reported = await call("POST", "/api/boards/presence/presence", {
      peer: "ipad",
      alice: GHOST,
    });
    expect(reported.status).toBe(204);
    expect(await laptop.nextEvent()).toEqual({ type: "presence", peer: "ipad", alice: GHOST });

    const late = readEvents(await call("GET", "/api/boards/presence/events"));
    expect(await late.nextEvent()).toEqual({ type: "cursor", seq: 0, boot: BOOT });
    expect(await late.nextEvent()).toEqual({ type: "presence", peer: "ipad", alice: GHOST });

    controller.abort();
    expect(await laptop.nextEvent()).toEqual({ type: "presence", peer: "ipad", alice: null });
    await laptop.cancel();
    await late.cancel();
  });

  it("answers 400 to a presence report it cannot read", async () => {
    expect(
      (await call("POST", "/api/boards/presence/presence", { peer: "Not A Peer", alice: GHOST }))
        .status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/boards/presence/presence", { peer: "ipad", alice: { x: 1 } }))
        .status,
    ).toBe(400);
  });
});
