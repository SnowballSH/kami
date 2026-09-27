import { describe, expect, it } from "vitest";
import { exemplarOf } from "./exemplar";

const line = [
  { x: 0, y: 0 },
  { x: 256, y: 128 },
];

describe("exemplarOf", () => {
  it("keeps a word's strokes inside the frame, as bare points", () => {
    const pressed = line.map((point) => ({ ...point, pressure: 0.5 }));
    expect(exemplarOf({ word: " rabbit ", strokes: [pressed] })).toEqual({
      word: "rabbit",
      strokes: [line],
    });
  });

  it.each<[string, unknown]>([
    ["no word", { word: "  ", strokes: [line] }],
    ["no strokes", { word: "rabbit", strokes: [] }],
    ["a lone point", { word: "rabbit", strokes: [[{ x: 1, y: 1 }]] }],
    ["a point outside the frame", { word: "rabbit", strokes: [[...line, { x: 300, y: 0 }]] }],
    ["a point that is not a number", { word: "rabbit", strokes: [[...line, { x: "1", y: 0 }]] }],
    ["nothing at all", null],
  ])("refuses %s", (_what, body) => {
    expect(exemplarOf(body)).toBeNull();
  });
});
