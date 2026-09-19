import "./styles/base.css";
import "./styles/hud.css";
import type { Vec } from "../core/geometry";
import { DomHud } from "./hud";
import { PenTracker } from "./pen";
import type { Detach, Hud, HudHandlers, PenSink } from "./types";

export type * from "./types";

/** Builds the HUD overlay inside `root` and listens for keyboard and on-screen walking. */
export function createHud(root: HTMLElement, handlers: HudHandlers): Hud {
  return new DomHud(root, handlers);
}

/** Routes one pointer at a time (finger, Pencil or mouse) from the canvas to `sink` in world space. */
export function attachPen(
  canvas: HTMLCanvasElement,
  toWorld: (clientX: number, clientY: number) => Vec,
  sink: PenSink,
): Detach {
  return new PenTracker(canvas, toWorld, sink).attach();
}
