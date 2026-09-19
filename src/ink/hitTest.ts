import { distanceToStroke, type Vec, worldToPose } from "../core/geometry";
import type { DrawingId, PosedDrawing } from "./types";

const inkPassesNear = ({ drawing, pose }: PosedDrawing, point: Vec, tolerance: number): boolean => {
  const drawnPoint = worldToPose(point, pose);
  return drawing.strokes.some((stroke) => distanceToStroke(drawnPoint, stroke) <= tolerance);
};

export const findTopmostDrawingAt = (
  point: Vec,
  drawings: readonly PosedDrawing[],
  tolerance: number,
): DrawingId | null =>
  drawings.findLast((posed) => inkPassesNear(posed, point, tolerance))?.drawing.id ?? null;
