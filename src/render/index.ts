import { CanvasRenderer } from "./canvasRenderer";
import type { Renderer } from "./types";

export type * from "./types";

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  return new CanvasRenderer(canvas);
}
