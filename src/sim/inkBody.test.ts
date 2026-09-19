import { describe, expect, it } from "vitest";
import { INK_THICKNESS } from "../core/world";
import { exactBounds } from "./bodyBounds";
import { SOLID_TO_ALL } from "./contacts";
import { buildInkBody, type InkBodyOptions, simplifyStroke } from "./inkBody";
import { line } from "./testSupport";

const OPTIONS: InkBodyOptions = {
  isStatic: false,
  material: { density: 0.004, friction: 0.8, frictionAir: 0.01, restitution: 0 },
  collisionFilter: SOLID_TO_ALL,
};

describe("simplifyStroke", () => {
  it("collapses a straight run of samples to its endpoints", () => {
    expect(simplifyStroke(line({ x: 0, y: 0 }, { x: 200, y: 0 }))).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it("keeps a corner", () => {
    const corner = [
      ...line({ x: 0, y: 0 }, { x: 100, y: 0 }),
      ...line({ x: 100, y: 0 }, { x: 100, y: 80 }),
    ];
    expect(simplifyStroke(corner)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
  });
});

describe("buildInkBody", () => {
  it("makes one compound as thick as the ink", () => {
    const body = buildInkBody([line({ x: 100, y: 100 }, { x: 300, y: 100 })], OPTIONS);
    expect(body).not.toBeNull();
    if (body === null) return;
    const bounds = exactBounds(body);
    expect(bounds.width).toBeCloseTo(200 + INK_THICKNESS);
    expect(bounds.height).toBeCloseTo(INK_THICKNESS);
  });

  it("turns a single point into a dot", () => {
    const body = buildInkBody([[{ x: 50, y: 50 }]], OPTIONS);
    expect(body?.position).toMatchObject({ x: 50, y: 50 });
  });

  it("has nothing to build from empty strokes", () => {
    expect(buildInkBody([[]], OPTIONS)).toBeNull();
  });
});
