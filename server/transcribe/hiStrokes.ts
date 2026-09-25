import type { Stroke } from "../../src/core/geometry";

/** "HI" in six straight strokes: what a reader is shown once before it is trusted with players. */
export const HI_STROKES: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
  ],
  [
    { x: 0, y: 20 },
    { x: 20, y: 20 },
  ],
  [
    { x: 20, y: 0 },
    { x: 20, y: 40 },
  ],
  [
    { x: 32, y: 0 },
    { x: 48, y: 0 },
  ],
  [
    { x: 40, y: 0 },
    { x: 40, y: 40 },
  ],
  [
    { x: 32, y: 40 },
    { x: 48, y: 40 },
  ],
];
