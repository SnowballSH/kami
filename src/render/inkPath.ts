import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Stroke } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import { TAU } from "./canvas2d";

const PEN: StrokeOptions = {
  size: INK_THICKNESS,
  thinning: 0.35,
  smoothing: 0.5,
  streamline: 0.35,
  simulatePressure: true,
  last: true,
};

const appendDot = (path: Path2D, stroke: Stroke): void => {
  const [dot] = stroke;
  if (dot === undefined) return;
  path.moveTo(dot.x + INK_THICKNESS / 2, dot.y);
  path.arc(dot.x, dot.y, INK_THICKNESS / 2, 0, TAU);
};

const appendOutline = (path: Path2D, stroke: Stroke): void => {
  const outline = getStroke([...stroke], PEN);
  const [start] = outline;
  if (start === undefined) return;
  path.moveTo(start[0], start[1]);
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length] ?? point;
    path.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
  });
  path.closePath();
};

export const appendStroke = (path: Path2D, stroke: Stroke): void =>
  stroke.length === 1 ? appendDot(path, stroke) : appendOutline(path, stroke);

export const inkPath = (strokes: readonly Stroke[]): Path2D => {
  const path = new Path2D();
  for (const stroke of strokes) appendStroke(path, stroke);
  return path;
};
