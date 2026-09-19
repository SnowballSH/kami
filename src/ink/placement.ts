import { expandRect, type Rect, rectContains, type Stroke, type Vec } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import type { PlacementRules, PlacementVerdict } from "./types";

type Interval = readonly [enter: number, exit: number];
type Segment = readonly [start: Vec, end: Vec];

const WHOLE_SEGMENT: Interval = [0, 1];
const NO_OVERLAP: Interval = [1, 0];

const axisInterval = (start: number, end: number, min: number, max: number): Interval => {
  const delta = end - start;
  if (delta === 0) return start >= min && start <= max ? WHOLE_SEGMENT : NO_OVERLAP;
  const toMin = (min - start) / delta;
  const toMax = (max - start) / delta;
  return [Math.min(toMin, toMax), Math.max(toMin, toMax)];
};

export const segmentCrossesRect = ([start, end]: Segment, rect: Rect): boolean => {
  const [enterX, exitX] = axisInterval(start.x, end.x, rect.x, rect.x + rect.width);
  const [enterY, exitY] = axisInterval(start.y, end.y, rect.y, rect.y + rect.height);
  return Math.max(0, enterX, enterY) <= Math.min(1, exitX, exitY);
};

const segmentsOf = (stroke: Stroke): readonly Segment[] => {
  const [first] = stroke;
  if (first === undefined) return [];
  if (stroke.length === 1) return [[first, first]];
  return stroke.slice(1).map((end, i): Segment => [stroke[i] ?? end, end]);
};

const touchesZone = (strokes: readonly Stroke[], zones: readonly Rect[]): boolean =>
  strokes.some((stroke) => stroke.some((point) => zones.some((zone) => rectContains(zone, point))));

const crossesRect = (strokes: readonly Stroke[], rect: Rect): boolean =>
  strokes.some((stroke) => segmentsOf(stroke).some((segment) => segmentCrossesRect(segment, rect)));

export const judgePlacement = (
  strokes: readonly Stroke[],
  { noInkZones, aliceBounds }: PlacementRules,
): PlacementVerdict => {
  if (touchesZone(strokes, noInkZones)) return "no-ink-zone";
  if (aliceBounds !== null && crossesRect(strokes, expandRect(aliceBounds, INK_THICKNESS / 2))) {
    return "overlaps-alice";
  }
  return "ok";
};
