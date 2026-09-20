import { describe, expect, it } from "vitest";
import type { AliceSnapshot } from "../sim/types";
import { lightsOf } from "./nightPainter";

const standing = (x: number): AliceSnapshot => ({
  center: { x, y: 100 },
  velocity: { x: 0, y: 0 },
  width: 28,
  height: 60,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
});

describe("lightsOf", () => {
  it("gives Alice and every twin a pool of light of their own", () => {
    const lights = lightsOf([standing(0), standing(300), standing(-300)], []);
    expect(lights.map((light) => light.center.x)).toEqual([0, 300, -300]);
    expect(new Set(lights.map((light) => light.radius)).size).toBe(1);
  });

  it("lights a bigger Alice more widely", () => {
    const [small, big] = lightsOf([standing(0), { ...standing(0), height: 120 }], []);
    expect(big?.radius ?? 0).toBeGreaterThan(small?.radius ?? 0);
  });
});
