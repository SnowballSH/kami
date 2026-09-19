// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/core/geometry";
import { circleSketch, lineSketch } from "../testing/sketches";
import { computeFeature } from "./feature";
import { countPoints, PREFIX_FRACTIONS, prefixOfStrokes } from "./prefix";
import { prefixFeaturesOf } from "./prefixFeatures";

const point = (index: number) => ({ x: index, y: index * 2 });
const strokeOf = (from: number, length: number): Stroke =>
  Array.from({ length }, (_, index) => point(from + index));

const TEN_POINTS: readonly Stroke[] = [strokeOf(0, 4), strokeOf(4, 3), strokeOf(7, 3)];

describe("prefixOfStrokes", () => {
  it("keeps the first share of the points in drawing order and cuts the stroke under the pen", () => {
    expect(prefixOfStrokes(TEN_POINTS, 0.5)).toEqual([strokeOf(0, 4), strokeOf(4, 1)]);
    expect(prefixOfStrokes(TEN_POINTS, 0.2)).toEqual([strokeOf(0, 2)]);
  });

  it("keeps a whole stroke when the share ends on its boundary, without opening the next", () => {
    expect(prefixOfStrokes(TEN_POINTS, 0.4)).toEqual([strokeOf(0, 4)]);
    expect(prefixOfStrokes(TEN_POINTS, 0.7)).toEqual([strokeOf(0, 4), strokeOf(4, 3)]);
  });

  it("is the whole drawing at 1 and beyond, and never less than one point", () => {
    expect(prefixOfStrokes(TEN_POINTS, 1)).toEqual(TEN_POINTS);
    expect(prefixOfStrokes(TEN_POINTS, 3)).toEqual(TEN_POINTS);
    expect(prefixOfStrokes(TEN_POINTS, 0)).toEqual([strokeOf(0, 1)]);
  });

  it("skips empty strokes and has nothing to show for no ink", () => {
    expect(prefixOfStrokes([[], strokeOf(0, 4), []], 0.5)).toEqual([strokeOf(0, 2)]);
    expect(prefixOfStrokes([], 0.5)).toEqual([]);
    expect(prefixOfStrokes([[]], 1)).toEqual([]);
  });

  it("leaves the drawing it was given untouched", () => {
    const before = structuredClone(TEN_POINTS);
    prefixOfStrokes(TEN_POINTS, 0.35);
    expect(TEN_POINTS).toEqual(before);
  });
});

describe("prefixFeaturesOf", () => {
  it("has one feature per indexed share, each fitted to the prefix's own bounds", () => {
    const circle = circleSketch({ x: 0, y: 0 }, 50);
    const features = prefixFeaturesOf(circle);
    expect(features.map(({ fraction }) => fraction)).toEqual([...PREFIX_FRACTIONS]);
    for (const { fraction, feature } of features) {
      expect(Array.from(feature)).toEqual(
        Array.from(computeFeature(prefixOfStrokes(circle, fraction))),
      );
    }
  });

  it("keeps shares that cut a short drawing at the same point only once, under the larger share", () => {
    const line = lineSketch({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(countPoints(line)).toBe(2);
    expect(prefixFeaturesOf(line).map(({ fraction }) => fraction)).toEqual([0.65, 1]);
  });
});
