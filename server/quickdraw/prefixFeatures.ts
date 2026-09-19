import type { Stroke } from "../../src/core/geometry";
import { computeFeature } from "./feature";
import { countPoints, PREFIX_FRACTIONS, prefixOfStrokes } from "./prefix";

export interface PrefixFeature {
  readonly fraction: number;
  readonly feature: Float32Array;
}

/**
 * One feature per indexed share of the drawing, each fitted to its own bounding box as a drawing
 * still under the pen would be. Shares that cut a short drawing at the same point are kept once,
 * under the larger share, so no sketch votes twice with the same picture.
 */
export const prefixFeaturesOf = (
  strokes: readonly Stroke[],
  fractions: readonly number[] = PREFIX_FRACTIONS,
): readonly PrefixFeature[] => {
  const byPointCount = new Map<number, PrefixFeature>();
  for (const fraction of [...fractions].sort((a, b) => a - b)) {
    const prefix = prefixOfStrokes(strokes, fraction);
    byPointCount.set(countPoints(prefix), { fraction, feature: computeFeature(prefix) });
  }
  return [...byPointCount.values()];
};
