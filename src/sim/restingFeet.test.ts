import { describe, expect, it } from "vitest";
import { restingFeet } from "./restingFeet";

describe("restingFeet", () => {
  it("raises a body whose frame overlaps the floor", () => {
    expect(
      restingFeet({ x: -20, y: -10, width: 40, height: 50 }, [
        { x: -100, y: 0, width: 200, height: 36 },
      ]),
    ).toBe(0);
  });

  it("leaves a body above a distant solid where it is", () => {
    expect(
      restingFeet({ x: -20, y: -100, width: 40, height: 40 }, [
        { x: -100, y: 100, width: 200, height: 36 },
      ]),
    ).toBe(-60);
  });
});
