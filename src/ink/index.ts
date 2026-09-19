import type { Vec } from "../core/geometry";
import { findTopmostDrawingAt } from "./hitTest";
import { pageDrawingIds } from "./ids";
import { PenInkSession } from "./session";
import type { DrawingId, InkSession, InkSessionListener, PosedDrawing } from "./types";

export type * from "./types";

export function createInkSession(listener: InkSessionListener): InkSession {
  return new PenInkSession(listener);
}

/** A fresh id for a drawing that did not come from the pen (a conjured one). */
export function mintDrawingId(): DrawingId {
  return pageDrawingIds.next();
}

/** The topmost (last-drawn) drawing whose ink passes within `tolerance` px of `point`. */
export function findDrawingAt(
  point: Vec,
  drawings: readonly PosedDrawing[],
  tolerance: number,
): DrawingId | null {
  return findTopmostDrawingAt(point, drawings, tolerance);
}
