import { describe, expect, it } from "vitest";
import type { Stroke, Vec } from "../core/geometry";
import { bearingStrokes, isSpan } from "./bearing";

const line = (from: Vec, to: Vec): Stroke => [from, to];
const arc = (from: Vec, to: Vec, sag: number): Stroke => [
  from,
  { x: (from.x + to.x) / 2, y: Math.max(from.y, to.y) + sag },
  to,
];

const deck = line({ x: 0, y: 100 }, { x: 400, y: 100 });
const leftTower = line({ x: 80, y: 100 }, { x: 80, y: -20 });
const rightTower = line({ x: 320, y: 100 }, { x: 320, y: -20 });
const cable = arc({ x: 80, y: -20 }, { x: 320, y: -20 }, 60);

describe("isSpan", () => {
  it("is a wide flat run", () => {
    expect(isSpan(deck)).toBe(true);
    expect(isSpan(leftTower)).toBe(false);
    expect(isSpan(cable)).toBe(false);
    expect(isSpan(line({ x: 0, y: 0 }, { x: 30, y: 0 }))).toBe(false);
  });
});

describe("bearingStrokes", () => {
  it("keeps only the deck of a suspension bridge", () => {
    expect(bearingStrokes([deck, leftTower, rightTower, cable])).toEqual([deck]);
  });

  it("keeps legs below a table top", () => {
    const top = line({ x: 0, y: 0 }, { x: 200, y: 0 });
    const legs = [
      line({ x: 10, y: 0 }, { x: 10, y: 80 }),
      line({ x: 190, y: 0 }, { x: 190, y: 80 }),
    ];
    expect(bearingStrokes([top, ...legs])).toEqual([top, ...legs]);
  });

  it("keeps a stroke that reaches past the span", () => {
    const wall = line({ x: 420, y: 100 }, { x: 420, y: 0 });
    expect(bearingStrokes([deck, wall])).toEqual([deck, wall]);
  });

  it("keeps stacked shelves and a lone stroke", () => {
    const shelf = line({ x: 50, y: 40 }, { x: 350, y: 40 });
    expect(bearingStrokes([deck, shelf])).toEqual([deck, shelf]);
    expect(bearingStrokes([cable])).toEqual([cable]);
  });
});
