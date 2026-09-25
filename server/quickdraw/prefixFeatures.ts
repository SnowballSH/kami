import type { Stroke } from "../../src/core/geometry";
import { computeFeature } from "./feature";
import { countPoints, PREFIX_FRACTIONS, prefixOfStrokes } from "./prefix";

export interface PrefixFeature {
  readonly fraction: number;
  readonly feature: Float32Array;
}

export interface IndexedPrefix {
  readonly fraction: number;
  readonly strokes: readonly Stroke[];
}

/**
 * The shares of the drawing that are indexed, smallest first and the whole drawing last. Shares
 * that cut a short drawing at the same point are kept once, under the larger share, so no sketch
 * votes twice with the same picture.
 */
export const indexedPrefixesOf = (
  strokes: readonly Stroke[],
  fractions: readonly number[] = PREFIX_FRACTIONS,
): readonly IndexedPrefix[] => {
  const byPointCount = new Map<number, IndexedPrefix>();
  for (const fraction of [...fractions].sort((a, b) => a - b)) {
    const prefix = prefixOfStrokes(strokes, fraction);
    byPointCount.set(countPoints(prefix), { fraction, strokes: prefix });
  }
  return [...byPointCount.values()];
};

/** One feature per indexed share, each fitted to its own bounding box as a drawing still under the pen would be. */
export const prefixFeaturesOf = (
  strokes: readonly Stroke[],
  fractions: readonly number[] = PREFIX_FRACTIONS,
): readonly PrefixFeature[] =>
  indexedPrefixesOf(strokes, fractions).map(({ fraction, strokes: prefix }) => ({
    fraction,
    feature: computeFeature(prefix),
  }));
