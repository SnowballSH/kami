import { expandRect, type Rect, type Stroke, type Vec } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import type { PlacementRules, PlacementVerdict } from "./types";

type Interval = readonly [enter: number, exit: number];

const WHOLE_SEGMENT: Interval = [0, 1];
const NO_OVERLAP: Interval = [1, 0];

const axisInterval = (start: number, end: number, min: number, max: number): Interval => {
  const delta = end - start;
  if (delta === 0) return start >= min && start <= max ? WHOLE_SEGMENT : NO_OVERLAP;
  const toMin = (min - start) / delta;
  const toMax = (max - start) / delta;
  return [Math.min(toMin, toMax), Math.max(toMin, toMax)];
};

const segmentCrossesRect = (start: Vec, end: Vec, rect: Rect): boolean => {
  const [enterX, exitX] = axisInterval(start.x, end.x, rect.x, rect.x + rect.width);
  const [enterY, exitY] = axisInterval(start.y, end.y, rect.y, rect.y + rect.height);
  return Math.max(0, enterX, enterY) <= Math.min(1, exitX, exitY);
};

const strokeCrossesRect = (stroke: Stroke, rect: Rect): boolean => {
  const [first] = stroke;
  if (first === undefined) return false;
  if (stroke.length === 1) return segmentCrossesRect(first, first, rect);
  for (let at = 1; at < stroke.length; at++) {
    const [start, end] = [stroke[at - 1], stroke[at]];
    if (start !== undefined && end !== undefined && segmentCrossesRect(start, end, rect))
      return true;
  }
  return false;
};

const crossesRect = (strokes: readonly Stroke[], rect: Rect): boolean =>
  strokes.some((stroke) => strokeCrossesRect(stroke, rect));

/** A quick flick samples few points, so the line between them is judged, not only the points. */
const touchesZone = (strokes: readonly Stroke[], zones: readonly Rect[]): boolean =>
  zones.some((zone) => crossesRect(strokes, zone));

export const isUnderGround = (point: Vec, solids: readonly Rect[]): boolean => {
  const bottom = solids.reduce(
    (lowest, { x, y, width, height }) =>
      point.x >= x && point.x <= x + width ? Math.max(lowest, y + height) : lowest,
    Number.NEGATIVE_INFINITY,
  );
  return bottom > Number.NEGATIVE_INFINITY && point.y > bottom;
};

const underGround = (strokes: readonly Stroke[], solids: readonly Rect[]): boolean =>
  strokes.some((stroke) => stroke.some((point) => isUnderGround(point, solids)));

export const judgePlacement = (
  strokes: readonly Stroke[],
  { noInkZones, solids, aliceBounds }: PlacementRules,
): PlacementVerdict => {
  if (touchesZone(strokes, noInkZones)) return "no-ink-zone";
  if (underGround(strokes, solids)) return "under-ground";
  if (aliceBounds !== null && crossesRect(strokes, expandRect(aliceBounds, INK_THICKNESS / 2))) {
    return "overlaps-alice";
  }
  return "ok";
};
