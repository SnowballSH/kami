import type { Vec } from "../core/geometry";
import type { Detach, Hud, HudHandlers, PenSink } from "./types";

export type * from "./types";

/** Builds the HUD overlay inside `root` and listens for keyboard and on-screen walking. */
export function createHud(_root: HTMLElement, _handlers: HudHandlers): Hud {
  throw new Error("not implemented");
}

/** Routes one pointer at a time (finger, Pencil or mouse) from the canvas to `sink` in world space. */
export function attachPen(
  _canvas: HTMLCanvasElement,
  _toWorld: (clientX: number, clientY: number) => Vec,
  _sink: PenSink,
): Detach {
  throw new Error("not implemented");
}
