import { describe, expect, it } from "vitest";
import type { Rect } from "../core/geometry";
import { CameraRig } from "./cameraRig";

const viewport = { width: 1200, height: 800 };
const aliceAt = (x: number, y: number): Rect => ({ x: x - 12, y: y - 40, width: 24, height: 40 });

describe("the camera on an endless page", () => {
  it("follows Alice as far as she goes, with no edge to stop at", () => {
    const rig = new CameraRig();
    rig.frame({ x: 0, y: 0 }, viewport);
    const far = { x: 5_000_000, y: -3_000_000 };
    for (let tick = 0; tick < 600; tick++) rig.follow(aliceAt(far.x, far.y), viewport);
    const { center } = rig.camera;
    expect(Math.abs(center.x - far.x)).toBeLessThan(viewport.width);
    expect(Math.abs(center.y - far.y)).toBeLessThan(viewport.height);
    expect(Number.isFinite(center.x) && Number.isFinite(center.y)).toBe(true);
  });

  it("frames her again wherever she is set down, e.g. after a fall", () => {
    const rig = new CameraRig();
    rig.frame({ x: 0, y: 0 }, viewport);
    rig.panBy({ x: 300, y: 0 });
    rig.follow(aliceAt(90_000, 90_000), viewport);
    expect(rig.camera.center.x).toBeLessThan(0);
    rig.frame({ x: 90_000, y: 90_000 }, viewport);
    expect(rig.camera.center.x).toBe(90_000);
    expect(rig.camera.center.y).toBeLessThan(90_000);
    rig.follow(aliceAt(90_000, 90_000), viewport);
    expect(rig.camera.center.x).toBe(90_000);
  });
});
