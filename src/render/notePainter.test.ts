import { describe, expect, it } from "vitest";
import type { PenScript } from "../handwriting/types";
import { settledStrokeCount, writingProgress } from "./notePainter";

const SCRIPT: PenScript = {
  text: "hi",
  strokes: [
    [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ],
    [
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ],
    [{ x: 20, y: 0 }],
  ],
  startsAtMs: [0, 150, 320],
  endsAtMs: [100, 250, 330],
  durationMs: 330,
  bounds: { x: 0, y: 0, width: 20, height: 20 },
};

describe("settledStrokeCount", () => {
  it("counts the strokes the pen has already lifted from", () => {
    expect(settledStrokeCount(SCRIPT, -50, 0)).toBe(0);
    expect(settledStrokeCount(SCRIPT, 99, 0)).toBe(0);
    expect(settledStrokeCount(SCRIPT, 100, 0)).toBe(1);
    expect(settledStrokeCount(SCRIPT, 300, 0)).toBe(2);
    expect(settledStrokeCount(SCRIPT, 5000, 0)).toBe(3);
  });

  it("carries on from where the last frame left off", () => {
    expect(settledStrokeCount(SCRIPT, 260, 1)).toBe(2);
    expect(settledStrokeCount(SCRIPT, 260, 2)).toBe(2);
    expect(settledStrokeCount(SCRIPT, 5000, 3)).toBe(3);
  });
});

describe("writingProgress", () => {
  it("runs from 0 to 1 over the script", () => {
    expect(writingProgress(SCRIPT, -10)).toBe(0);
    expect(writingProgress(SCRIPT, 165)).toBe(0.5);
    expect(writingProgress(SCRIPT, 9999)).toBe(1);
  });

  it("treats an empty script as already written", () => {
    expect(writingProgress({ ...SCRIPT, strokes: [], durationMs: 0 }, 0)).toBe(1);
  });
});
