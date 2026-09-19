import { distance, type Stroke, strokeLength, type Vec } from "../core/geometry";
import { lerp } from "./resample";
import type { PenScript } from "./types";

const NOTHING_WRITTEN: readonly Stroke[] = [];

/** The first `length` px of a stroke, ending on an interpolated point. */
export const cutAtLength = (stroke: Stroke, length: number): Stroke => {
  const [first, ...rest] = stroke;
  if (first === undefined) return stroke;
  const cut: Vec[] = [first];
  let from = first;
  let remaining = length;
  for (const point of rest) {
    const step = distance(from, point);
    if (step >= remaining) {
      if (remaining > 0) cut.push(lerp(from, point, remaining / step));
      return cut;
    }
    cut.push(point);
    remaining -= step;
    from = point;
  }
  return cut;
};

const strokeInProgress = (stroke: Stroke, startMs: number, endMs: number, nowMs: number): Stroke =>
  cutAtLength(stroke, (strokeLength(stroke) * (nowMs - startMs)) / (endMs - startMs));

export const revealStrokes = (script: PenScript, elapsedMs: number): readonly Stroke[] => {
  if (elapsedMs <= 0) return NOTHING_WRITTEN;
  if (!(elapsedMs < script.durationMs)) return script.strokes;
  const revealed: Stroke[] = [];
  for (const [i, stroke] of script.strokes.entries()) {
    const startMs = script.startsAtMs[i] ?? Number.POSITIVE_INFINITY;
    const endMs = script.endsAtMs[i] ?? Number.POSITIVE_INFINITY;
    if (elapsedMs < endMs) {
      if (elapsedMs > startMs) revealed.push(strokeInProgress(stroke, startMs, endMs, elapsedMs));
      break;
    }
    revealed.push(stroke);
  }
  return revealed;
};
