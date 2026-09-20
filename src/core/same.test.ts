import { describe, expect, it } from "vitest";
import { same } from "./same";

describe("same", () => {
  it("compares by structure, not identity", () => {
    expect(same({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
    expect(same({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe(false);
    expect(same([1, 2], [1, 2, 3])).toBe(false);
    expect(same(Number.NaN, Number.NaN)).toBe(true);
  });

  it("treats a key that is missing and a key that is undefined alike, as JSON would", () => {
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: null })).toBe(false);
  });

  it("never mistakes an array for an object or a primitive for either", () => {
    expect(same([], {})).toBe(false);
    expect(same({ length: 0 }, [])).toBe(false);
    expect(same("1", 1)).toBe(false);
    expect(same(null, {})).toBe(false);
  });
});
