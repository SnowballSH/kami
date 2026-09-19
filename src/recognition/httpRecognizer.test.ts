import { describe, expect, it } from "vitest";
import type { Drawing, DrawingId } from "../ink/types";
import { type FetchLike, HttpRecognizer } from "./httpRecognizer";

const drawing: Drawing = {
  id: "drawing-1" as DrawingId,
  strokes: [
    [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
  ],
  cost: 14,
};

describe("HttpRecognizer", () => {
  it("posts the strokes with a deadline and returns the guesses in order", async () => {
    const seen: { path: string; body: unknown; hasDeadline: boolean }[] = [];
    const recognizer = new HttpRecognizer(async (path, init) => {
      seen.push({
        path,
        body: JSON.parse(String(init?.body)),
        hasDeadline: init?.signal instanceof AbortSignal,
      });
      return Response.json({ guesses: ["mushroom", "umbrella"] });
    });
    expect(await recognizer.recognize(drawing)).toEqual(["mushroom", "umbrella"]);
    expect(seen).toEqual([
      { path: "/api/recognize", body: { strokes: drawing.strokes }, hasDeadline: true },
    ]);
  });

  it.each<[string, FetchLike]>([
    [
      "the server is away",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
    [
      "the request times out",
      async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    ],
    ["the server errors", async () => new Response("boom", { status: 500 })],
    ["the body is not JSON", async () => new Response("<html>")],
    ["the guesses are not words", async () => Response.json({ guesses: [1, 2] })],
  ])("returns no guesses when %s", async (_what, fetchFn) => {
    expect(await new HttpRecognizer(fetchFn).recognize(drawing)).toEqual([]);
  });

  const seenByServer = {
    guesses: ["mushroom", "umbrella"],
    confidence: [0.8, 0.1],
    names: ["a mushroom", "an umbrella"],
    natures: ["bouncy", "floaty"],
    strengths: [1.2, 1],
    lines: ["Spongy. Do try one.", "Up it goes."],
  };

  it("sights a finished sketch: each guess with what it is in the game", async () => {
    const bodies: unknown[] = [];
    const recognizer = new HttpRecognizer(async (_path, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(seenByServer);
    });
    expect(await recognizer.sight(drawing.strokes)).toEqual([
      {
        word: "mushroom",
        confidence: 0.8,
        name: "a mushroom",
        nature: "bouncy",
        strength: 1.2,
        line: "Spongy. Do try one.",
      },
      {
        word: "umbrella",
        confidence: 0.1,
        name: "an umbrella",
        nature: "floaty",
        strength: 1,
        line: "Up it goes.",
      },
    ]);
    expect(bodies).toEqual([{ strokes: drawing.strokes }]);
  });

  it("says so when the pen is still moving", async () => {
    const bodies: unknown[] = [];
    const recognizer = new HttpRecognizer(async (_path, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        ...seenByServer,
        guesses: [],
        confidence: [],
        names: [],
        natures: [],
        strengths: [],
        lines: [],
      });
    });
    expect(await recognizer.sight(drawing.strokes, { partial: true })).toEqual([]);
    expect(bodies).toEqual([{ strokes: drawing.strokes, partial: true }]);
  });

  it.each<[string, unknown]>([
    ["an older server that only lists words", { guesses: ["mushroom"], confidence: [0.8] }],
    ["columns of different lengths", { ...seenByServer, lines: ["only one"] }],
    ["a nature the game does not know", { ...seenByServer, natures: ["bouncy", "gaseous"] }],
    ["nothing at all", null],
  ])("sights nothing given %s", async (_what, body) => {
    const recognizer = new HttpRecognizer(async () => Response.json(body));
    expect(await recognizer.sight(drawing.strokes)).toEqual([]);
  });

  it("sights nothing when the server is away", async () => {
    const recognizer = new HttpRecognizer(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await recognizer.sight(drawing.strokes, { partial: true })).toEqual([]);
  });
});
