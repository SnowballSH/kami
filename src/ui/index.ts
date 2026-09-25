import "./styles/base.css";
import "./styles/hud.css";
import "./styles/laws.css";
import { CanvasInput } from "./canvasInput";
import { DomHud } from "./hud";
import { DomLawsPanel } from "./lawsPanel";
import type {
  CanvasInputSink,
  Detach,
  Hud,
  HudHandlers,
  HudOptions,
  LawsPanel,
  LawsPanelHandlers,
  Tool,
} from "./types";

export type * from "./types";

/** Builds the HUD overlay inside `root` and listens for keyboard and on-screen walking. */
export function createHud(root: HTMLElement, handlers: HudHandlers, options: HudOptions = {}): Hud {
  return new DomHud(root, handlers, options);
}

/** Mounts the list of standing laws inside `root`; tapping a law twice repeals it. */
export function createLawsPanel(root: HTMLElement, handlers: LawsPanelHandlers): LawsPanel {
  const panel = new DomLawsPanel(handlers);
  root.append(panel.element);
  return panel;
}

/** Turns pointers, pinches and the wheel on the canvas into pen, tap, pan and zoom for `sink`. */
export function attachCanvasInput(
  canvas: HTMLCanvasElement,
  currentTool: () => Tool,
  sink: CanvasInputSink,
): Detach {
  return new CanvasInput(canvas, currentTool, sink).attach();
}
