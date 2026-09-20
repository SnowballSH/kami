import { describe, expect, it } from "vitest";
import type { Rect } from "../core/geometry";
import { CameraRig } from "./cameraRig";

const VIEWPORT = { width: 1000, height: 800 };
const body = (x: number, y = 0): Rect => ({ x: x - 14, y: y - 30, width: 28, height: 60 });

const settled = (subject: Rect, company: readonly Rect[]): number => {
  const rig = new CameraRig();
  rig.frame({ x: 0, y: 0 }, VIEWPORT);
  for (let tick = 0; tick < 400; tick++) rig.follow(subject, VIEWPORT, company);
  return rig.camera.center.x;
};

describe("CameraRig among several Alices", () => {
  it("pins the arena and ignores following until it is framed again", () => {
    const rig = new CameraRig();
    rig.pin({ x: 10, y: -20 }, 0.8);
    rig.follow(body(3000), VIEWPORT);
    rig.resumeFollowing();
    expect(rig.camera).toMatchObject({ center: { x: 10, y: -20 }, zoom: 0.8 });
    rig.frame({ x: 40, y: 50 }, VIEWPORT);
    expect(rig.camera.center).toEqual({ x: 40, y: 50 - 170 });
  });

  it("keeps framing the selected Alice, leaning a little toward company close by", () => {
    const alone = settled(body(1000), []);
    const withCompany = settled(body(1000), [body(1400)]);
    expect(alone).toBeGreaterThan(500);
    expect(alone).toBeLessThan(1000);
    expect(withCompany).toBeGreaterThan(alone);
    expect(withCompany - alone).toBeLessThan(200);
  });

  it("ignores company more than half a screen away", () => {
    expect(settled(body(1000), [body(2000)])).toBe(settled(body(1000), []));
  });

  it("stays put once the player has taken the camera", () => {
    const rig = new CameraRig();
    rig.panBy({ x: 100, y: 0 });
    const taken = rig.camera.center.x;
    rig.follow(body(3000), VIEWPORT, [body(3300)]);
    expect(rig.camera.center.x).toBe(taken);
  });
});

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
