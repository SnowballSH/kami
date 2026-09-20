import { describe, expect, it } from "vitest";
import { IDENTITY_POSE, type Pose, type Rect } from "../core/geometry";
import { visibleWorld } from "./camera";
import { posedInView, rectInView } from "./culling";

const VIEW: Rect = { x: 0, y: 0, width: 1000, height: 800 };
const DRAWN: Rect = { x: 100, y: 100, width: 60, height: 20 };

describe("rectInView", () => {
  it("keeps what overlaps the view and drops what is clear of it", () => {
    expect(rectInView({ x: 900, y: 700, width: 300, height: 300 }, VIEW, 0)).toBe(true);
    expect(rectInView({ x: 1200, y: 100, width: 50, height: 50 }, VIEW, 0)).toBe(false);
    expect(rectInView({ x: 100, y: -400, width: 50, height: 50 }, VIEW, 0)).toBe(false);
  });

  it("keeps something just off the edge when its marker line would still show", () => {
    const beside: Rect = { x: 1004, y: 100, width: 50, height: 50 };
    expect(rectInView(beside, VIEW, 0)).toBe(false);
    expect(rectInView(beside, VIEW, 10)).toBe(true);
  });

  it("keeps a slab far bigger than the view", () => {
    expect(rectInView({ x: -5000, y: 400, width: 20000, height: 4000 }, VIEW, 0)).toBe(true);
  });

  it("sees more of the board the further the camera zooms out", () => {
    const box = { width: 1000, height: 800 };
    const far: Rect = { x: 1500, y: 0, width: 40, height: 40 };
    const center = { x: 0, y: 0 };
    expect(rectInView(far, visibleWorld({ center, zoom: 1, angle: 0 }, box), 0)).toBe(false);
    expect(rectInView(far, visibleWorld({ center, zoom: 0.25, angle: 0 }, box), 0)).toBe(true);
  });
});

describe("posedInView", () => {
  it("follows ink to wherever the simulation has carried it", () => {
    const carriedAway: Pose = {
      origin: { x: 130, y: 110 },
      position: { x: 5000, y: 110 },
      angle: 1,
      scale: 1,
    };
    expect(posedInView(DRAWN, IDENTITY_POSE, VIEW, 0)).toBe(true);
    expect(posedInView(DRAWN, carriedAway, VIEW, 0)).toBe(false);
  });

  it("never culls ink that a rotation could swing into view", () => {
    const tall: Rect = { x: -30, y: -400, width: 20, height: 380 };
    const swung: Pose = {
      origin: { x: -20, y: -20 },
      position: { x: -20, y: -20 },
      angle: Math.PI,
      scale: 1,
    };
    expect(posedInView(tall, swung, VIEW, 0)).toBe(true);
  });
});
