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
