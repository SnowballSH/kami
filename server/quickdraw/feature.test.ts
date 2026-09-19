// @vitest-environment node
import { describe, expect, it } from "vitest";
import { circleSketch, lineSketch, transformSketch } from "../testing/sketches";
import { computeFeature, FEATURE_LENGTH } from "./feature";

const cosine = (a: Float32Array, b: Float32Array): number =>
  a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

const mushroom = [
  [
    { x: 10, y: 60 },
    { x: 40, y: 10 },
    { x: 90, y: 12 },
    { x: 120, y: 60 },
    { x: 10, y: 60 },
  ],
  [
    { x: 55, y: 60 },
    { x: 52, y: 130 },
    { x: 78, y: 131 },
    { x: 75, y: 60 },
  ],
];

describe("computeFeature", () => {
  it("is a unit vector of the grid's length", () => {
    const feature = computeFeature(mushroom);
    expect(feature).toHaveLength(FEATURE_LENGTH);
    expect(cosine(feature, feature)).toBeCloseTo(1, 5);
  });

  it("does not care where on the board the sketch is", () => {
    const moved = transformSketch(mushroom, 1, { x: 4321, y: -987 });
    expect(cosine(computeFeature(mushroom), computeFeature(moved))).toBeCloseTo(1, 4);
  });

  it("does not care how large the sketch is", () => {
    const enlarged = transformSketch(mushroom, 7.5, { x: 0, y: 0 });
    expect(cosine(computeFeature(mushroom), computeFeature(enlarged))).toBeCloseTo(1, 4);
  });

  it("keeps the aspect ratio, so a flat line and a circle stay different", () => {
    const circle = computeFeature(circleSketch({ x: 0, y: 0 }, 50));
    const line = computeFeature(lineSketch({ x: 0, y: 0 }, { x: 300, y: 4 }));
    expect(cosine(circle, line)).toBeLessThan(0.5);
  });

  it("is all zeros for no ink and finite for a single dot", () => {
    expect(computeFeature([]).every((value) => value === 0)).toBe(true);
    expect(computeFeature([[]]).every((value) => value === 0)).toBe(true);
    const dot = computeFeature([[{ x: 5, y: 5 }]]);
    expect(cosine(dot, dot)).toBeCloseTo(1, 5);
  });
});
