import { describe, expect, it } from "vitest";
import { DEAD_ZONE, deflectionOf, directionsOf } from "./joystick";

const held = (x: number, y: number): readonly string[] => [...directionsOf({ x, y })].sort();

describe("deflectionOf", () => {
  it("scales an offset inside the rim to a fraction of the radius", () => {
    expect(deflectionOf({ x: 30, y: -15 }, 60)).toEqual({ x: 0.5, y: -0.25 });
  });

  it("clamps a thumb dragged past the rim onto it", () => {
    const { x, y } = deflectionOf({ x: 300, y: 400 }, 50);
    expect(Math.hypot(x, y)).toBeCloseTo(1);
    expect(x / y).toBeCloseTo(0.75);
  });
});

describe("directionsOf", () => {
  it("holds nothing inside the dead zone", () => {
    expect(held(0, 0)).toEqual([]);
    expect(held(DEAD_ZONE * 0.9, -DEAD_ZONE * 0.9)).toEqual([]);
  });

  it("walks along the axis the thumb is pushed", () => {
    expect(held(1, 0)).toEqual(["right"]);
    expect(held(-0.6, 0.1)).toEqual(["left"]);
    expect(held(0, -1)).toEqual(["up"]);
    expect(held(0.2, 0.9)).toEqual(["down"]);
  });

  it("ignores a slight upward drift while walking, but takes a real diagonal", () => {
    expect(held(0.9, -0.35)).toEqual(["right"]);
    expect(held(0.7, -0.7)).toEqual(["right", "up"]);
    expect(held(-0.5, 0.5)).toEqual(["down", "left"]);
  });
});
