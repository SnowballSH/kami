import { describe, expect, it, vi } from "vitest";
import { type Direction, toWalkIntent, WalkIntentMerger } from "./walkIntent";

const pressed = (...directions: Direction[]): ReadonlySet<Direction> => new Set(directions);

describe("toWalkIntent", () => {
  it("is idle with nothing held", () => {
    expect(toWalkIntent(pressed())).toEqual({ x: 0, y: 0 });
  });

  it("maps directions onto axes with up as -1", () => {
    expect(toWalkIntent(pressed("right", "up"))).toEqual({ x: 1, y: -1 });
    expect(toWalkIntent(pressed("left", "down"))).toEqual({ x: -1, y: 1 });
  });

  it("cancels opposite directions", () => {
    expect(toWalkIntent(pressed("left", "right", "up", "down"))).toEqual({ x: 0, y: 0 });
  });
});

describe("WalkIntentMerger", () => {
  it("unions its sources and only emits changes", () => {
    const emit = vi.fn();
    const merger = new WalkIntentMerger(emit);
    const dpad = merger.source();
    const keys = merger.source();

    dpad(pressed("right"));
    keys(pressed("right"));
    keys(pressed("left"));
    dpad(pressed());
    keys(pressed());

    expect(emit.mock.calls.map(([intent]) => intent)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });
});
