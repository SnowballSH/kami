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
});
