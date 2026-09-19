import type { Vec } from "../core/geometry";
import type { DrawingId, InkSession, InkSessionListener, PosedDrawing } from "./types";

export type * from "./types";

export function createInkSession(_listener: InkSessionListener): InkSession {
  throw new Error("not implemented");
}

/** The topmost (last-drawn) drawing whose ink passes within `tolerance` px of `point`. */
export function findDrawingAt(
  _point: Vec,
  _drawings: readonly PosedDrawing[],
  _tolerance: number,
): DrawingId | null {
  throw new Error("not implemented");
}
