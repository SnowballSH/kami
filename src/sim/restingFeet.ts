import type { Rect } from "../core/geometry";

export const restingFeet = (frame: Rect, solids: readonly Rect[]): number => {
  const bottom = frame.y + frame.height;
  const top = solids
    .filter(
      (solid) =>
        solid.x < frame.x + frame.width &&
        frame.x < solid.x + solid.width &&
        solid.y < bottom &&
        frame.y < solid.y + solid.height,
    )
    .reduce((highest, solid) => Math.min(highest, solid.y), Number.POSITIVE_INFINITY);
  return Number.isFinite(top) ? top : bottom;
};
