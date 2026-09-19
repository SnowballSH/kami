import type { Renderer } from "./types";

export type * from "./types";

export function createRenderer(_canvas: HTMLCanvasElement): Renderer {
  throw new Error("not implemented");
}
