import { boundsOf, distanceToSegment, type Rect, type Stroke } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";

const MIN_SPAN = 60;
const MAX_SLOPE = 0.25;
const MAX_BOW = 0.1;
const SLACK = INK_THICKNESS;

/** A straight, near-level run wide enough to walk along: a deck, a floor, a shelf. */
export const isSpan = (stroke: Stroke): boolean => {
  const first = stroke[0];
  const last = stroke.at(-1);
  if (first === undefined || last === undefined) return false;
  const width = Math.abs(last.x - first.x);
  if (width < MIN_SPAN || Math.abs(last.y - first.y) > width * MAX_SLOPE) return false;
  return stroke.every((point) => distanceToSegment(point, first, last) <= width * MAX_BOW);
};

const restsOn = (part: Rect, span: Rect): boolean =>
  part.x >= span.x - SLACK &&
  part.x + part.width <= span.x + span.width + SLACK &&
  part.y + part.height <= span.y + span.height + SLACK;

/**
 * The strokes of a drawing that hold weight. In a side view, what is drawn above a span and
 * within it (towers, cables, walls, a roof) stands behind the walkway, not on it; those strokes
 * are scenery, and Alice passes through them to walk the span itself.
 */
export const bearingStrokes = (strokes: readonly Stroke[]): readonly Stroke[] => {
  if (strokes.length < 2) return strokes;
  const flat = strokes.map(isSpan);
  const bounds = strokes.map(boundsOf);
  const spans = bounds.filter((_, index) => flat[index] === true);
  return strokes.filter((_, index) => {
    const own = bounds[index];
    return own === undefined || flat[index] === true || !spans.some((span) => restsOn(own, span));
  });
};
