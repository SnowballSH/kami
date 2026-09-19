import type { Stroke } from "../../src/core/geometry";

/** How much of each stored drawing is indexed, as shares of its points in drawing order. */
export const PREFIX_FRACTIONS = [0.2, 0.35, 0.65, 1] as const;

export const COMPLETE_FRACTION = 1;

export const countPoints = (strokes: readonly Stroke[]): number =>
  strokes.reduce((sum, stroke) => sum + stroke.length, 0);

const pointsWithin = (total: number, fraction: number): number =>
  total === 0 ? 0 : Math.min(total, Math.max(1, Math.round(total * fraction)));

/**
 * A drawing as it looked part-way through: the first `fraction` of its points in drawing order,
 * at least one, with stroke boundaries kept and the stroke under the pen cut short.
 */
export const prefixOfStrokes = (
  strokes: readonly Stroke[],
  fraction: number,
): readonly Stroke[] => {
  let remaining = pointsWithin(countPoints(strokes), fraction);
  const prefix: Stroke[] = [];
  for (const stroke of strokes) {
    if (remaining <= 0) break;
    if (stroke.length === 0) continue;
    prefix.push(stroke.slice(0, remaining));
    remaining -= stroke.length;
  }
  return prefix;
};
