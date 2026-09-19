import { describe, expect, it } from "vitest";
import { awakening, inkTint, isSettled, SHIVER_MS, shiverOffset } from "./awakening";
import { FOUNTAIN_BLUE, NATURE_TINTS } from "./palette";

describe("awakening", () => {
  it("runs from 0 to 1 over the shiver and then stays settled", () => {
    expect(awakening(1000, 1000)).toBe(0);
    expect(awakening(1000 + SHIVER_MS / 2, 1000)).toBe(0.5);
    expect(awakening(1000 + SHIVER_MS * 4, 1000)).toBe(1);
    expect(isSettled(awakening(1000 + SHIVER_MS, 1000))).toBe(true);
  });

  it("treats unnamed ink as settled", () => {
    expect(isSettled(awakening(1000, null))).toBe(true);
  });

  it("shivers less and less until it is still", () => {
    const reach = (progress: number): number =>
      Math.max(
        ...[0, 7, 19, 31, 43].map((nowMs) => {
          const offset = shiverOffset(nowMs, progress);
          return Math.hypot(offset.x, offset.y);
        }),
      );
    expect(reach(0)).toBeGreaterThan(reach(0.6));
    expect(reach(0.6)).toBeGreaterThan(0);
    expect(reach(1)).toBe(0);
  });

  it("starts blue and ends on the nature's tint", () => {
    expect(inkTint("bouncy", 0)).toEqual(FOUNTAIN_BLUE);
    expect(inkTint("bouncy", 1)).toEqual(NATURE_TINTS.bouncy);
    expect(inkTint("ink", 0.5)).toEqual(FOUNTAIN_BLUE);
  });
});
