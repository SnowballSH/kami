import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { Stroke } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import { TAU } from "./canvas2d";

export type Pen = StrokeOptions & { readonly size: number };

export const NOTE_THICKNESS = 2.2;

/** A pen that reports pressure draws with it; a mouse or a finger gets pressure faked from speed. */
export const INK_PEN: Pen = {
  size: INK_THICKNESS * 0.8,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.2,
  simulatePressure: true,
  last: true,
};

export const NOTE_PEN: Pen = {
  size: NOTE_THICKNESS,
  thinning: 0.1,
  smoothing: 0.5,
  streamline: 0,
  simulatePressure: true,
  last: true,
};

const hasPressure = (stroke: Stroke): boolean => stroke[0]?.pressure !== undefined;

const penFor = (stroke: Stroke, pen: Pen): Pen =>
  pen.simulatePressure === true && hasPressure(stroke) ? { ...pen, simulatePressure: false } : pen;

const appendDot = (path: Path2D, stroke: Stroke, pen: Pen): void => {
  const [dot] = stroke;
  if (dot === undefined) return;
  const radius = (pen.size / 2) * (dot.pressure === undefined ? 1 : 0.5 + dot.pressure / 2);
  path.moveTo(dot.x + radius, dot.y);
  path.arc(dot.x, dot.y, radius, 0, TAU);
};

const appendOutline = (path: Path2D, stroke: Stroke, pen: Pen): void => {
  const outline = getStroke([...stroke], penFor(stroke, pen));
  const [start] = outline;
  if (start === undefined) return;
  path.moveTo(start[0], start[1]);
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length] ?? point;
    path.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
  });
  path.closePath();
};

export const appendStroke = (path: Path2D, stroke: Stroke, pen: Pen): void =>
  stroke.length === 1 ? appendDot(path, stroke, pen) : appendOutline(path, stroke, pen);

export const strokesPath = (strokes: readonly Stroke[], pen: Pen): Path2D => {
  const path = new Path2D();
  for (const stroke of strokes) appendStroke(path, stroke, pen);
  return path;
};
