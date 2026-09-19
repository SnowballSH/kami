import type { Handwriting } from "../handwriting/types";
import type { Renderer } from "./types";

export type * from "./types";

export function createRenderer(_canvas: HTMLCanvasElement, _handwriting: Handwriting): Renderer {
  throw new Error("not implemented");
}
