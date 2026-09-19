import { describe, expect, it } from "vitest";
import { NATURES } from "../cat/types";
import { FOUNTAIN_BLUE, mapNatures, mixRgb, NATURE_TINTS, rgbCss } from "./palette";

describe("palette", () => {
  it("has a tint for every nature", () => {
    for (const nature of NATURES) {
      expect(NATURE_TINTS[nature]).toHaveLength(3);
    }
    expect(Object.keys(NATURE_TINTS).sort()).toEqual([...NATURES].sort());
  });

  it("keeps plain ink fountain-pen blue and every other nature its own colour", () => {
    expect(NATURE_TINTS.ink).toEqual(FOUNTAIN_BLUE);
    const tints = new Set(NATURES.map((nature) => rgbCss(NATURE_TINTS[nature])));
    expect(tints.size).toBe(NATURES.length);
  });

  it("mixes from one colour to another", () => {
    expect(mixRgb([0, 0, 0], [200, 100, 50], 0)).toEqual([0, 0, 0]);
    expect(mixRgb([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
    expect(mixRgb([0, 0, 0], [200, 100, 50], 1)).toEqual([200, 100, 50]);
  });

  it("writes canvas-ready colours", () => {
    expect(rgbCss([1, 2, 3])).toBe("rgba(1, 2, 3, 1)");
    expect(rgbCss([1, 2, 3], 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("maps a value onto every nature", () => {
    const names = mapNatures((nature) => nature.toUpperCase());
    expect(names.bouncy).toBe("BOUNCY");
    expect(Object.keys(names)).toHaveLength(NATURES.length);
  });
});
