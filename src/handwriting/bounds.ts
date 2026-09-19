import type { Rect, Stroke, Vec } from "../core/geometry";

/** The tight box around every point; with no points, an empty rect at `emptyAt`. */
export const tightBounds = (strokes: readonly Stroke[], emptyAt: Vec): Rect => {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (const { x, y } of stroke) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (left > right) return { x: emptyAt.x, y: emptyAt.y, width: 0, height: 0 };
  return { x: left, y: top, width: right - left, height: bottom - top };
};
