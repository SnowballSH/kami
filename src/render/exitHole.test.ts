import { describe, expect, it } from "vitest";
import { expandRect, rectContains } from "../core/geometry";
import { raggedOutline } from "./exitHole";
import { seededRandom } from "./random";

const EXIT = { x: 850, y: 660, width: 100, height: 108 };

describe("raggedOutline", () => {
  it("tears the hole inside the exit", () => {
    const outline = raggedOutline(EXIT, seededRandom(7));
    expect(outline.length).toBeGreaterThan(8);
    for (const point of outline) {
      expect(rectContains(expandRect(EXIT, 1e-9), point)).toBe(true);
    }
  });

  it("tears the same hole every time, so the page does not boil", () => {
    expect(raggedOutline(EXIT, seededRandom(7))).toEqual(raggedOutline(EXIT, seededRandom(7)));
    expect(raggedOutline(EXIT, seededRandom(7))).not.toEqual(raggedOutline(EXIT, seededRandom(8)));
  });
});
