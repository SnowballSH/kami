import { distance, lerpVec, type Stroke } from "../core/geometry";

/** Splits every segment longer than `maxSegment` into equal parts; the path itself is unchanged. */
export const resample = (stroke: Stroke, maxSegment: number): Stroke =>
  stroke.flatMap((point, i) => {
    const previous = stroke[i - 1];
    if (previous === undefined || !(maxSegment > 0)) return [point];
    const parts = Math.max(1, Math.ceil(distance(previous, point) / maxSegment));
    return Array.from({ length: parts }, (_, part) => lerpVec(previous, point, (part + 1) / parts));
  });
