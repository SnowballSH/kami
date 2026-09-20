import { describe, expect, it } from "vitest";
import { CameraRig } from "../game/cameraRig";
import { deviceTransform, type Size, toClient, toWorld, visibleWorld } from "./camera";
import type { Camera } from "./types";

const BOX: Size = { width: 1366, height: 1024 };
const CENTER = { x: 2310.5, y: -140.25 };
const POINT = { x: 1999.3, y: 610.7 };
const ANGLES = [0, 30, 90, 180, -90, 137.5];

const turned = (angle: number, zoom = 1.7): Camera => ({ center: CENTER, zoom, angle });

const throughDevice = (camera: Camera, world: { x: number; y: number }, pixelRatio: number) => {
  const { scale, turn, dx, dy } = deviceTransform(camera, BOX, pixelRatio);
  const cos = Math.cos(turn) * scale;
  const sin = Math.sin(turn) * scale;
  return { x: cos * world.x - sin * world.y + dx, y: sin * world.x + cos * world.y + dy };
};

describe("a turned camera", () => {
  it.each(ANGLES)("keeps the centre in the middle of the canvas at %s°", (angle) => {
    const middle = { x: BOX.width / 2, y: BOX.height / 2 };
    expect(toClient(CENTER, turned(angle), BOX)).toEqual(middle);
    expect(toWorld(middle, turned(angle), BOX)).toEqual(CENTER);
  });

  it.each(ANGLES)("round-trips world points through client px at %s°", (angle) => {
    const camera = turned(angle);
    const back = toWorld(toClient(POINT, camera, BOX), camera, BOX);
    expect(back.x).toBeCloseTo(POINT.x, 9);
    expect(back.y).toBeCloseTo(POINT.y, 9);
  });

  it("turns clockwise on screen: at 90° world-right points down the canvas", () => {
    const camera = turned(90, 1);
    const from = toClient(CENTER, camera, BOX);
    const right = toClient({ x: CENTER.x + 10, y: CENTER.y }, camera, BOX);
    expect(right.x - from.x).toBeCloseTo(0, 9);
    expect(right.y - from.y).toBeCloseTo(10, 9);
    const flipped = toClient({ x: CENTER.x + 10, y: CENTER.y }, turned(180, 1), BOX);
    expect(flipped.x - from.x).toBeCloseTo(-10, 9);
  });

  it.each(ANGLES)("agrees with the canvas matrix at %s°", (angle) => {
    const camera = turned(angle);
    const client = toClient(POINT, camera, BOX);
    const device = throughDevice(camera, POINT, 2);
    expect(device.x).toBeCloseTo(client.x * 2, 6);
    expect(device.y).toBeCloseTo(client.y * 2, 6);
  });

  it.each(ANGLES)("sees a world rectangle that covers every canvas corner at %s°", (angle) => {
    const camera = turned(angle);
    const view = visibleWorld(camera, BOX);
    for (const corner of [
      { x: 0, y: 0 },
      { x: BOX.width, y: 0 },
      { x: 0, y: BOX.height },
      { x: BOX.width, y: BOX.height },
    ]) {
      const world = toWorld(corner, camera, BOX);
      expect(world.x).toBeGreaterThanOrEqual(view.x - 1e-6);
      expect(world.x).toBeLessThanOrEqual(view.x + view.width + 1e-6);
      expect(world.y).toBeGreaterThanOrEqual(view.y - 1e-6);
      expect(world.y).toBeLessThanOrEqual(view.y + view.height + 1e-6);
    }
  });

  it("sees exactly the upright viewport at 0° and a swapped one at 90°", () => {
    const upright = visibleWorld(turned(0, 1), BOX);
    expect(upright.width).toBeCloseTo(BOX.width, 9);
    expect(upright.height).toBeCloseTo(BOX.height, 9);
    const sideways = visibleWorld(turned(90, 1), BOX);
    expect(sideways.width).toBeCloseTo(BOX.height, 9);
    expect(sideways.height).toBeCloseTo(BOX.width, 9);
  });
});

describe("the rig under a turned paper", () => {
  const rigAt = (angle: number): CameraRig => {
    const rig = new CameraRig();
    rig.frame({ x: 100, y: 200 }, BOX);
    rig.turnTo(angle);
    return rig;
  };

  it("keeps the angle across framing, following and zooming", () => {
    const rig = rigAt(90);
    expect(rig.camera.angle).toBe(90);
    rig.frame({ x: 0, y: 0 }, BOX);
    rig.follow({ x: 900, y: 900, width: 10, height: 10 }, BOX);
    rig.zoomAt({ x: 10, y: 10 }, 1.5, (client, camera) => toWorld(client, camera, BOX));
    expect(rig.camera.angle).toBe(90);
  });

  it("pans along the screen, so a drag down at 90° moves the view along world x", () => {
    const rig = rigAt(90);
    const before = rig.camera.center;
    rig.panBy({ x: 0, y: 50 });
    const { center, zoom } = rig.camera;
    expect(center.x - before.x).toBeCloseTo(-50 / zoom, 9);
    expect(center.y - before.y).toBeCloseTo(0, 9);
  });

  it("zooms about the point under the pencil whichever way the paper is turned", () => {
    const rig = rigAt(137.5);
    const client = { x: 300, y: 700 };
    const before = toWorld(client, rig.camera, BOX);
    rig.zoomAt(client, 2, (at, camera) => toWorld(at, camera, BOX));
    const after = toWorld(client, rig.camera, BOX);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
