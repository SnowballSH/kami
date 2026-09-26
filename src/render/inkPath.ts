import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { PenPoint, Stroke } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import { TAU } from "./canvas2d";

export type Pen = StrokeOptions & { readonly size: number };

export const NOTE_THICKNESS = 2.2;
/** Drawn thinner than the ink's physical thickness: a fine pen over a body that stays as solid as before. */
export const PEN_THICKNESS = INK_THICKNESS / 2;

/**
 * A pen that reports pressure draws with it. Ink without pressure (a mouse, a finger, a drawing read
 * back from the store, anything Kami drew) keeps one steady width: pressure faked from speed makes a
 * line as thin as its points are far apart — 5.5 px at 2 px apart, 2.3 px at 7 px — and thins every
 * stroke's start to nothing, so strokes that meet end to end show white notches between them.
 */
export const INK_PEN: Pen = {
  size: PEN_THICKNESS,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.2,
  simulatePressure: false,
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

type Outline = ReturnType<typeof getStroke>;

interface TracedOutline {
  readonly pointCount: number;
  readonly lastPoint: PenPoint | undefined;
  readonly outline: Outline;
}

/** Keyed by pen, then stroke; a pending stroke grows in place, so its length and last point are checked too. */
const tracedOutlines = new WeakMap<Pen, WeakMap<Stroke, TracedOutline>>();

const outlineOf = (stroke: Stroke, pen: Pen): Outline => {
  let traced = tracedOutlines.get(pen);
  if (traced === undefined) {
    traced = new WeakMap();
    tracedOutlines.set(pen, traced);
  }
  const lastPoint = stroke.at(-1);
  const cached = traced.get(stroke);
  if (cached?.pointCount === stroke.length && cached.lastPoint === lastPoint) return cached.outline;
  const outline = getStroke([...stroke], penFor(stroke, pen));
  traced.set(stroke, { pointCount: stroke.length, lastPoint, outline });
  return outline;
};

const appendOutline = (path: Path2D, stroke: Stroke, pen: Pen): void => {
  const outline = outlineOf(stroke, pen);
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
