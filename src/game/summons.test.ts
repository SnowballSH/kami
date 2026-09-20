import { describe, expect, it } from "vitest";
import { boundsOf, rectsOverlap } from "../core/geometry";
import { placeSummoned, SUMMONED_SIZE, summonsOf } from "./summons";

describe("summonsOf", () => {
  it.each([
    ["summon a rabbit", "a rabbit"],
    ["Summon a rabbit!", "a rabbit"],
    ["draw me a bridge here", "a bridge"],
    ["kami, draw a moon", "a moon"],
    ["hey kami, please conjure up two clouds", "two clouds"],
    ["can you sketch a hot air balloon next to alice", "a hot air balloon"],
    ["spawn a car for her, please", "a car"],
    ["draw us a cat right here", "a cat"],
  ])("hears %j as asking for %j", (text, what) => {
    expect(summonsOf(text)).toBe(what);
  });

  it.each([
    "a rabbit",
    "make a cloud",
    "g = moon",
    "the wheel spins",
    "summon",
    "summon the ink eater",
    "draw the sumikui here",
    "drawn out",
  ])("hears nothing to draw in %j", (text) => {
    expect(summonsOf(text)).toBeNull();
  });
});

describe("placeSummoned", () => {
  const picture = [
    [
      { x: 0, y: 128 },
      { x: 255, y: 128 },
    ],
    [
      { x: 128, y: 100 },
      { x: 128, y: 156 },
    ],
  ];
  const writing = { x: 300, y: 500, width: 120, height: 30 };

  it("fits the picture to its size, centred over the words and just above them", () => {
    const placed = placeSummoned(picture, writing, null);
    const bounds = boundsOf(placed.flat());
    expect(bounds.width).toBeCloseTo(SUMMONED_SIZE);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(360);
    expect(bounds.y + bounds.height).toBeLessThan(writing.y);
    expect(bounds.y + bounds.height).toBeGreaterThan(writing.y - 30);
    expect(placed.map((stroke) => stroke.length)).toEqual([2, 2]);
  });

  it("lifts the picture clear of Alice when she stands where it would land", () => {
    const alice = { x: 340, y: 420, width: 28, height: 60 };
    const placed = placeSummoned(picture, writing, alice);
    const bounds = boundsOf(placed.flat());
    expect(rectsOverlap(bounds, alice)).toBe(false);
    expect(bounds.y + bounds.height).toBeLessThan(alice.y);
  });

  it("leaves a thin sliver of a picture its shape", () => {
    const flat = [
      [
        { x: 10, y: 50 },
        { x: 60, y: 50 },
      ],
    ];
    const placed = placeSummoned(flat, writing, null);
    const bounds = boundsOf(placed.flat());
    expect(bounds.width).toBeCloseTo(SUMMONED_SIZE);
    expect(bounds.height).toBe(0);
  });
});
