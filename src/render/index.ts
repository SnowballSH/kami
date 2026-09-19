import type { Handwriting } from "../handwriting/types";
import { CanvasRenderer } from "./canvasRenderer";
import type { Renderer } from "./types";

export type * from "./types";

export function createRenderer(canvas: HTMLCanvasElement, handwriting: Handwriting): Renderer {
  return new CanvasRenderer(canvas, handwriting);
}
