import { boundsOf, distance, type Stroke, strokeLength } from "../core/geometry";
import type { Drawing } from "../ink/types";

export type ShapeKind = "dot" | "tall" | "flat" | "round" | "blob";

const DOT_SPAN = 30;
const TALL_ASPECT = 1.8;
const FLAT_ASPECT = 0.5;
const CLOSED_GAP_RATIO = 0.25;
const CLOSED_LOOP_RATIO = 2;
const MIN_EXTENT = 1;

const longestOf = (strokes: readonly Stroke[]): Stroke =>
  strokes.reduce<Stroke>(
    (longest, stroke) => (strokeLength(stroke) > strokeLength(longest) ? stroke : longest),
    [],
  );

const isClosedLoop = (stroke: Stroke, span: number): boolean => {
  const first = stroke.at(0);
  const last = stroke.at(-1);
  if (first === undefined || last === undefined) return false;
  return (
    distance(first, last) <= span * CLOSED_GAP_RATIO &&
    strokeLength(stroke) >= span * CLOSED_LOOP_RATIO
  );
};

export const spanOf = (drawing: Drawing): number => {
  const points = drawing.strokes.flat();
  if (points.length === 0) return 0;
  const { width, height } = boundsOf(points);
  return Math.hypot(width, height);
};

export const isDot = (drawing: Drawing): boolean => spanOf(drawing) < DOT_SPAN;

export const classifyShape = (drawing: Drawing): ShapeKind => {
  const points = drawing.strokes.flat();
  if (points.length === 0) return "blob";
  if (isDot(drawing)) return "dot";
  const { width, height } = boundsOf(points);
  const aspect = height / Math.max(width, MIN_EXTENT);
  if (aspect >= TALL_ASPECT) return "tall";
  if (aspect <= FLAT_ASPECT) return "flat";
  return isClosedLoop(longestOf(drawing.strokes), spanOf(drawing)) ? "round" : "blob";
};
