import { describe, expect, it } from "vitest";
import { drawingOf } from "../sim/testSupport";
import { InkCompletion } from "./inkCompletion";

const ORIGINAL = drawingOf("ink", [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
]);
const COMPLETION = {
  tidied: [
    [
      { x: 0, y: 2 },
      { x: 40, y: 2 },
    ],
  ],
  added: [
    [
      { x: 40, y: 2 },
      { x: 40, y: 80 },
    ],
  ],
  word: "platform",
  confidence: 0.9,
};

describe("InkCompletion", () => {
  it("tweens corresponding points before revealing the added strokes with the pen", () => {
    const animation = new InkCompletion(ORIGINAL, COMPLETION, 100);
    expect(animation.strokesAt(100)).toBe(ORIGINAL.strokes);
    expect(animation.strokesAt(275)).toEqual([
      [
        { x: 0, y: 1 },
        { x: 40, y: 1 },
      ],
    ]);
    const writing = animation.strokesAt(490);
    expect(writing[0]).toEqual(COMPLETION.tidied[0]);
    expect(writing[1]?.at(-1)?.y).toBeGreaterThan(2);
    expect(writing[1]?.at(-1)?.y).toBeLessThan(80);
    expect(animation.done(490)).toBe(false);
    expect(animation.done(700)).toBe(true);
    expect(animation.strokesAt(700)).toBe(animation.drawing.strokes);
    expect(animation.drawing).toEqual({
      ...ORIGINAL,
      strokes: [...COMPLETION.tidied, ...COMPLETION.added],
    });
  });

  it("finishes a tidy-only result without waiting for nonexistent added ink", () => {
    const animation = new InkCompletion(ORIGINAL, { ...COMPLETION, added: [] }, 100);
    expect(animation.done(449)).toBe(false);
    expect(animation.done(450)).toBe(true);
    expect(animation.strokesAt(450)).toEqual(COMPLETION.tidied);
  });

  it("bounds the reveal time for long added strokes", () => {
    const animation = new InkCompletion(
      ORIGINAL,
      {
        ...COMPLETION,
        added: [
          [
            { x: 0, y: 0 },
            { x: 10_000, y: 0 },
          ],
        ],
      },
      0,
    );
    expect(animation.done(1_549)).toBe(false);
    expect(animation.done(1_550)).toBe(true);
  });
});
