import "./styles/base.css";
import "./styles/hud.css";
import { CanvasInput } from "./canvasInput";
import { DomHud } from "./hud";
import type { CanvasInputSink, Detach, Hud, HudHandlers, Tool } from "./types";

export type * from "./types";

/** Builds the HUD overlay inside `root` and listens for keyboard and on-screen walking. */
export function createHud(root: HTMLElement, handlers: HudHandlers): Hud {
  return new DomHud(root, handlers);
}

/** Turns pointers, pinches and the wheel on the canvas into pen, tap, pan and zoom for `sink`. */
export function attachCanvasInput(
  canvas: HTMLCanvasElement,
  currentTool: () => Tool,
  sink: CanvasInputSink,
): Detach {
  return new CanvasInput(canvas, currentTool, sink).attach();
}
