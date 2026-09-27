import { PenInkSession } from "./session";
import type { InkSession, InkSessionListener } from "./types";

export { findDrawingAt } from "./hitTest";
export type * from "./types";

export function createInkSession(listener: InkSessionListener): InkSession {
  return new PenInkSession(listener);
}
