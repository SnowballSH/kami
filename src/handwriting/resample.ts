import { distance, type Stroke, type Vec } from "../core/geometry";

export const lerp = (from: Vec, to: Vec, t: number): Vec => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/** Splits every segment longer than `maxSegment` into equal parts; the path itself is unchanged. */
export const resample = (stroke: Stroke, maxSegment: number): Stroke =>
  stroke.flatMap((point, i) => {
    const previous = stroke[i - 1];
    if (previous === undefined || !(maxSegment > 0)) return [point];
    const parts = Math.max(1, Math.ceil(distance(previous, point) / maxSegment));
    return Array.from({ length: parts }, (_, part) => lerp(previous, point, (part + 1) / parts));
  });
