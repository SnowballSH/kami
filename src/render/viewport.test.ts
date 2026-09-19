import { describe, expect, it } from "vitest";
import { WORLD } from "../core/world";
import {
  backingStoreSize,
  cappedPixelRatio,
  deviceTransform,
  fitViewport,
  MAX_PIXEL_RATIO,
  type Size,
  toScreen,
  toWorld,
} from "./viewport";

const BOXES: Readonly<Record<string, Size>> = {
  landscape: { width: 1366, height: 768 },
  portrait: { width: 768, height: 1024 },
  exact: { width: 2048, height: 1536 },
};

describe("fitViewport", () => {
  it("pillarboxes a landscape box", () => {
    expect(fitViewport({ width: 1366, height: 768 })).toEqual({
      scale: 1,
      offset: { x: 171, y: 0 },
    });
  });

  it("letterboxes a portrait box", () => {
    expect(fitViewport({ width: 768, height: 1024 })).toEqual({
      scale: 0.75,
      offset: { x: 0, y: 224 },
    });
  });

  it("fills an exact 4:3 box edge to edge", () => {
    expect(fitViewport({ width: 2048, height: 1536 })).toEqual({
      scale: 2,
      offset: { x: 0, y: 0 },
    });
  });

  it("stays invertible for a canvas that has no size yet", () => {
    const viewport = fitViewport({ width: 0, height: 0 });
    const world = toWorld(viewport, { x: 0, y: 0 });
    expect(Number.isFinite(world.x) && Number.isFinite(world.y)).toBe(true);
  });

  it.each(Object.entries(BOXES))("keeps the whole page inside a %s box", (_name, box) => {
    const viewport = fitViewport(box);
    const topLeft = toScreen(viewport, { x: 0, y: 0 });
    const bottomRight = toScreen(viewport, { x: WORLD.width, y: WORLD.height });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(box.width + 1e-9);
    expect(bottomRight.y).toBeLessThanOrEqual(box.height + 1e-9);
  });

  it.each(Object.entries(BOXES))("round-trips world points through a %s box", (_name, box) => {
    const viewport = fitViewport(box);
    const point = { x: 333.3, y: 610.7 };
    const back = toWorld(viewport, toScreen(viewport, point));
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  it("maps the centre of the box to the centre of the page", () => {
    const world = toWorld(fitViewport({ width: 768, height: 1024 }), { x: 384, y: 512 });
    expect(world).toEqual({ x: WORLD.width / 2, y: WORLD.height / 2 });
  });
});

describe("device pixels", () => {
  it("caps the pixel ratio for fill-rate and survives a missing one", () => {
    expect(cappedPixelRatio(3)).toBe(MAX_PIXEL_RATIO);
    expect(cappedPixelRatio(1.5)).toBe(1.5);
    expect(cappedPixelRatio(0.5)).toBe(1);
    expect(cappedPixelRatio(undefined)).toBe(1);
    expect(cappedPixelRatio(Number.NaN)).toBe(1);
  });

  it("sizes the backing store to the CSS box times the pixel ratio", () => {
    expect(backingStoreSize({ width: 1180, height: 820 }, 2)).toEqual({
      width: 2360,
      height: 1640,
    });
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
  });

  it("snaps the page to whole device pixels", () => {
    const transform = deviceTransform(fitViewport({ width: 1181, height: 768 }), 2);
    expect(transform).toEqual({ scale: 2, dx: 157, dy: 0 });
  });
});
