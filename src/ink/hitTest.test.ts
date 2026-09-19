import { describe, expect, it } from "vitest";
import { IDENTITY_POSE, type Pose, type Stroke } from "../core/geometry";
import { findDrawingAt } from "./index";
import type { DrawingId, PosedDrawing } from "./types";

const posed = (
  id: string,
  strokes: readonly Stroke[],
  pose: Pose = IDENTITY_POSE,
): PosedDrawing => ({
  drawing: { id: id as DrawingId, strokes, cost: 0 },
  pose,
});

const HORIZONTAL: Stroke = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

describe("findDrawingAt", () => {
  it("finds ink within the tolerance and nothing beyond it", () => {
    const drawings = [posed("line", [HORIZONTAL])];
    expect(findDrawingAt({ x: 50, y: 8 }, drawings, 10)).toBe("line");
    expect(findDrawingAt({ x: 50, y: 30 }, drawings, 10)).toBeNull();
  });

  it("follows a drawing that has moved and turned", () => {
    const fallen: Pose = {
      origin: { x: 50, y: 0 },
      position: { x: 300, y: 400 },
      angle: Math.PI / 2,
    };
    const drawings = [posed("fallen", [HORIZONTAL], fallen)];
    expect(findDrawingAt({ x: 300, y: 440 }, drawings, 5)).toBe("fallen");
    expect(findDrawingAt({ x: 340, y: 400 }, drawings, 5)).toBeNull();
    expect(findDrawingAt({ x: 50, y: 0 }, drawings, 5)).toBeNull();
  });

  it("prefers the last-drawn of overlapping drawings", () => {
    const drawings = [posed("first", [HORIZONTAL]), posed("second", [HORIZONTAL])];
    expect(findDrawingAt({ x: 10, y: 0 }, drawings, 5)).toBe("second");
  });
});
