import { describe, expect, it } from "vitest";
import {
  backingStoreSize,
  cappedPixelRatio,
  deviceTransform,
  MAX_PIXEL_RATIO,
  type Size,
  toClient,
  toWorld,
  visibleWorld,
} from "./camera";
import type { Camera } from "./types";

const BOX: Size = { width: 1366, height: 1024 };
const ZOOMS = [0.25, 0.5, 1, 1.7, 4];
const PIXEL_RATIOS = [1, 1.5, 2];
const CENTER = { x: 2310.5, y: -140.25 };
const POINT = { x: 1999.3, y: 610.7 };

const cameraAt = (zoom: number): Camera => ({ center: CENTER, zoom, angle: 0 });

describe("camera", () => {
  it.each(ZOOMS)("puts the camera centre in the middle of the canvas at zoom %s", (zoom) => {
    const world = toWorld({ x: BOX.width / 2, y: BOX.height / 2 }, cameraAt(zoom), BOX);
    expect(world).toEqual(CENTER);
  });

  it.each(ZOOMS)("round-trips world points through client px at zoom %s", (zoom) => {
    const camera = cameraAt(zoom);
    const back = toWorld(toClient(POINT, camera, BOX), camera, BOX);
    expect(back.x).toBeCloseTo(POINT.x, 9);
    expect(back.y).toBeCloseTo(POINT.y, 9);
  });

  it.each(ZOOMS)("moves one world px per `zoom` client px at zoom %s", (zoom) => {
    const camera = cameraAt(zoom);
    const from = toClient(POINT, camera, BOX);
    const to = toClient({ x: POINT.x + 10, y: POINT.y - 10 }, camera, BOX);
    expect(to.x - from.x).toBeCloseTo(10 * zoom, 9);
    expect(to.y - from.y).toBeCloseTo(-10 * zoom, 9);
  });

  it.each(ZOOMS.flatMap((zoom) => PIXEL_RATIOS.map((pixelRatio) => ({ zoom, pixelRatio }))))(
    "agrees with the canvas transform at zoom $zoom and DPR $pixelRatio",
    ({ zoom, pixelRatio }) => {
      const camera = cameraAt(zoom);
      const { scale, dx, dy } = deviceTransform(camera, BOX, pixelRatio);
      const client = toClient(POINT, camera, BOX);
      expect(POINT.x * scale + dx).toBeCloseTo(client.x * pixelRatio, 6);
      expect(POINT.y * scale + dy).toBeCloseTo(client.y * pixelRatio, 6);
      const back = toWorld(
        { x: (POINT.x * scale + dx) / pixelRatio, y: (POINT.y * scale + dy) / pixelRatio },
        camera,
        BOX,
      );
      expect(back.x).toBeCloseTo(POINT.x, 6);
      expect(back.y).toBeCloseTo(POINT.y, 6);
    },
  );

  it.each(ZOOMS)("sees exactly the world between the canvas corners at zoom %s", (zoom) => {
    const camera = cameraAt(zoom);
    const view = visibleWorld(camera, BOX);
    const topLeft = toWorld({ x: 0, y: 0 }, camera, BOX);
    const bottomRight = toWorld({ x: BOX.width, y: BOX.height }, camera, BOX);
    expect(view.x).toBeCloseTo(topLeft.x, 9);
    expect(view.y).toBeCloseTo(topLeft.y, 9);
    expect(view.x + view.width).toBeCloseTo(bottomRight.x, 9);
    expect(view.y + view.height).toBeCloseTo(bottomRight.y, 9);
  });

  it("stays finite for a canvas with no size and a camera with no zoom", () => {
    const world = toWorld(
      { x: 5, y: 5 },
      { center: CENTER, zoom: 0, angle: 0 },
      { width: 0, height: 0 },
    );
    expect(Number.isFinite(world.x) && Number.isFinite(world.y)).toBe(true);
    const lost = toWorld({ x: 5, y: 5 }, { center: CENTER, zoom: Number.NaN, angle: 0 }, BOX);
    expect(Number.isFinite(lost.x) && Number.isFinite(lost.y)).toBe(true);
  });
});

describe("device pixels", () => {
  it("caps the pixel ratio and survives a missing one", () => {
    expect(cappedPixelRatio(3)).toBe(MAX_PIXEL_RATIO);
    expect(cappedPixelRatio(1.5)).toBe(1.5);
    expect(cappedPixelRatio(0.5)).toBe(1);
    expect(cappedPixelRatio(undefined)).toBe(1);
    expect(cappedPixelRatio(Number.NaN)).toBe(1);
  });

  it("sizes the backing store in whole device pixels, never zero", () => {
    expect(backingStoreSize({ width: 1366, height: 1024 }, 2)).toEqual({
      width: 2732,
      height: 2048,
    });
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 1, height: 1 });
  });
});
