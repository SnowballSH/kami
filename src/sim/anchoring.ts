import { distance, distanceToRect, type Rect, type Stroke, type Vec } from "../core/geometry";
import { ANCHOR_CLUSTER_SPACING, ANCHOR_REACH, ANCHOR_SAMPLE_SPACING } from "./constants";

const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const resample = (stroke: Stroke, spacing = ANCHOR_SAMPLE_SPACING): Stroke =>
  stroke.flatMap((point, i) => {
    const next = stroke[i + 1];
    if (next === undefined) return [point];
    const pieces = Math.max(1, Math.ceil(distance(point, next) / spacing));
    return Array.from({ length: pieces }, (_, piece) => lerp(point, next, piece / pieces));
  });

/** How many separate places the ink touches something it can hold on to. */
export const countAnchorClusters = (
  strokes: readonly Stroke[],
  anchors: readonly Rect[],
): number => {
  const touching = strokes
    .flatMap((stroke) => resample(stroke))
    .filter((point) => anchors.some((rect) => distanceToRect(point, rect) <= ANCHOR_REACH));
  const seeds: Vec[] = [];
  for (const point of touching) {
    if (seeds.every((seed) => distance(seed, point) >= ANCHOR_CLUSTER_SPACING)) seeds.push(point);
  }
  return seeds.length;
};
