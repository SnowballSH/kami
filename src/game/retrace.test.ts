import { describe, expect, it } from "vitest";
import type { Stroke } from "../core/geometry";
import { RETRACE_MS, retracedStrokes, retraceProgress } from "./retrace";

const drawn: Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
];
const tidied: Stroke[] = [
  [
    { x: 0, y: 2 },
    { x: 10, y: 4 },
  ],
];
const added: Stroke = [
  { x: 20, y: 0 },
  { x: 20, y: 5 },
  { x: 20, y: 10 },
  { x: 20, y: 15 },
];

describe("retracedStrokes", () => {
  it("starts as the player's ink and ends as the tidied drawing", () => {
    expect(retracedStrokes(drawn, [...tidied, added], 0)).toEqual(drawn);
    expect(retracedStrokes(drawn, [...tidied, added], 1)).toEqual([...tidied, added]);
  });

  it("glides every point toward its tidied place before anything is added", () => {
    const [stroke, ...rest] = retracedStrokes(drawn, [...tidied, added], 0.3);
    expect(rest).toEqual([]);
    expect(stroke?.[1]?.y).toBeGreaterThan(0);
    expect(stroke?.[1]?.y).toBeLessThan(4);
  });

  it("draws the added strokes in once the tidying is done", () => {
    const partly = retracedStrokes(drawn, [...tidied, added], 0.8);
    expect(partly[0]).toEqual(tidied[0]);
    expect(partly[1]?.length).toBeGreaterThan(1);
    expect(partly[1]?.length).toBeLessThan(added.length);
  });

  it("jumps straight to the tidied drawing if it is not point for point the player's", () => {
    const other: Stroke[] = [[{ x: 1, y: 1 }]];
    expect(retracedStrokes(drawn, other, 0.2)).toBe(other);
  });
});

describe("retraceProgress", () => {
  it("runs from 0 to 1 over the retrace, and stays there", () => {
    const retrace = { from: drawn, startedAtMs: 1000 };
    expect(retraceProgress(retrace, 900)).toBe(0);
    expect(retraceProgress(retrace, 1000 + RETRACE_MS / 2)).toBeCloseTo(0.5);
    expect(retraceProgress(retrace, 1000 + RETRACE_MS * 3)).toBe(1);
  });
});
