import { describe, expect, it } from "vitest";
import {
  boundsOf,
  distanceToRect,
  distanceToStroke,
  type Pose,
  poseToWorld,
  rectsOverlap,
  strokesLength,
  worldToPose,
} from "./geometry";

describe("geometry", () => {
  it("measures ink by stroke length", () => {
    const strokes = [
      [
        { x: 0, y: 0 },
        { x: 30, y: 40 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    ];
    expect(strokesLength(strokes)).toBe(70);
  });

  it("bounds points", () => {
    expect(
      boundsOf([
        { x: 5, y: 9 },
        { x: -1, y: 2 },
      ]),
    ).toEqual({ x: -1, y: 2, width: 6, height: 7 });
  });

  it("detects rect overlap but not mere touching", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("measures distance to rects and strokes", () => {
    expect(distanceToRect({ x: 13, y: 14 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(5);
    expect(
      distanceToStroke({ x: 5, y: 3 }, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe(3);
  });

  it("round-trips points through a pose", () => {
    const pose: Pose = {
      origin: { x: 10, y: 10 },
      position: { x: 50, y: 20 },
      angle: Math.PI / 2,
      scale: 1,
    };
    const world = poseToWorld({ x: 20, y: 10 }, pose);
    expect(world.x).toBeCloseTo(50);
    expect(world.y).toBeCloseTo(30);
    const back = worldToPose(world, pose);
    expect(back.x).toBeCloseTo(20);
    expect(back.y).toBeCloseTo(10);
  });
});
