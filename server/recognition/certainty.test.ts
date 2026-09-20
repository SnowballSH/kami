// @vitest-environment node
import { describe, expect, it } from "vitest";
import { floorFor, isCertain } from "./certainty";
import type { CertaintyFloors } from "./types";

const FLOORS: CertaintyFloors = { finished: 0.8, partial: null };
const cake = (confidence: number) => ({ category: "cake", confidence });

describe("floorFor", () => {
  it("is the finished floor unless the drawing is still under the pen", () => {
    expect(floorFor(FLOORS)).toBe(0.8);
    expect(floorFor(FLOORS, { partial: false })).toBe(0.8);
    expect(floorFor(FLOORS, { partial: true })).toBeNull();
  });
});

describe("isCertain", () => {
  it("needs a leader that reaches the floor", () => {
    expect(isCertain(cake(0.8), 0.8)).toBe(true);
    expect(isCertain(cake(0.7999), 0.8)).toBe(false);
    expect(isCertain(undefined, 0)).toBe(false);
  });

  it("is never certain without a floor", () => {
    expect(isCertain(cake(1), null)).toBe(false);
  });
});
