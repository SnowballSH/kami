import type { CanvasInputSink, Detach, Hud, HudHandlers, Tool } from "./types";

export type * from "./types";

/** Builds the HUD overlay inside `root` and listens for keyboard and on-screen walking. */
export function createHud(_root: HTMLElement, _handlers: HudHandlers): Hud {
  throw new Error("not implemented");
}

/** Turns pointers, pinches and the wheel on the canvas into pen, tap, pan and zoom for `sink`. */
export function attachCanvasInput(
  _canvas: HTMLCanvasElement,
  _currentTool: () => Tool,
  _sink: CanvasInputSink,
): Detach {
  throw new Error("not implemented");
}
