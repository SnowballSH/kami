import { boundsOf, poseToWorld, rectCenter, type Vec } from "../core/geometry";
import type { AliceSnapshot } from "../sim/types";
import { applyDeviceTransform, type DeviceTransform, type Size } from "./camera";
import { context2d } from "./canvas2d";
import type { InkView } from "./types";

/** How dark full night gets; some board always shows through. */
const NIGHT_OPACITY = 0.88;
const NIGHT_COLOR = "rgb(12, 14, 36)";
const LANTERN_RADIUS = 260;
/** Alice and each of her twins carry a little light of their own, so they can always be found. */
const ALICE_GLOW_RADIUS = 70;
const FULL_LIGHT_UNTIL = 0.35;

export interface Light {
  readonly center: Vec;
  readonly radius: number;
}

export const lightsOf = (
  alices: readonly AliceSnapshot[],
  inks: readonly InkView[],
): readonly Light[] => [
  ...alices.map((alice) => ({
    center: alice.center,
    radius: ALICE_GLOW_RADIUS * Math.sqrt(alice.height / 80),
  })),
  ...inks
    .filter((ink) => ink.nature === "lantern")
    .map((ink) => ({
      center: poseToWorld(rectCenter(boundsOf(ink.drawing.strokes.flat())), ink.pose),
      radius: LANTERN_RADIUS,
    })),
];

/**
 * Darkens the whole board when daylight drops below 1, then cuts a soft pool of light around each
 * lantern and around Alice. Drawn on its own layer so the holes take nothing from the board beneath.
 */
export class NightPainter {
  private layer: HTMLCanvasElement | null = null;

  paint(
    ctx: CanvasRenderingContext2D,
    daylight: number,
    lights: readonly Light[],
    store: Size,
    transform: DeviceTransform,
  ): void {
    if (daylight >= 1) return;
    const layer = this.layerSized(ctx.canvas, store);
    const night = context2d(layer);
    night.setTransform(1, 0, 0, 1, 0, 0);
    night.globalCompositeOperation = "source-over";
    night.clearRect(0, 0, store.width, store.height);
    night.globalAlpha = (1 - daylight) * NIGHT_OPACITY;
    night.fillStyle = NIGHT_COLOR;
    night.fillRect(0, 0, store.width, store.height);

    night.globalAlpha = 1;
    night.globalCompositeOperation = "destination-out";
    applyDeviceTransform(night, transform);
    for (const { center, radius } of lights) {
      const glow = night.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
      glow.addColorStop(0, "rgba(0, 0, 0, 1)");
      glow.addColorStop(FULL_LIGHT_UNTIL, "rgba(0, 0, 0, 0.9)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      night.fillStyle = glow;
      night.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
  }

  private layerSized(canvas: HTMLCanvasElement, store: Size): HTMLCanvasElement {
    const layer = this.layer ?? canvas.ownerDocument.createElement("canvas");
    this.layer = layer;
    if (layer.width !== store.width) layer.width = store.width;
    if (layer.height !== store.height) layer.height = store.height;
    return layer;
  }
}
