import type { Stroke, Vec } from "../core/geometry";

/** A drawing on its way from the player's ink to Kami's tidied version of it. */
export interface Retrace {
  readonly from: readonly Stroke[];
  readonly startedAtMs: number;
}

export const RETRACE_MS = 650;
const TIDY_SHARE = 0.6;

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const between = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const sameShape = (from: readonly Stroke[], to: readonly Stroke[]): boolean =>
  from.length <= to.length && from.every((stroke, index) => stroke.length === to[index]?.length);

export const retraceProgress = (retrace: Retrace, nowMs: number): number =>
  Math.min(1, Math.max(0, (nowMs - retrace.startedAtMs) / RETRACE_MS));

/**
 * The strokes to show at `progress` (0–1): first the player's own strokes glide point for point
 * into their tidied places, then whatever Kami added is drawn in, stroke after stroke.
 */
export const retracedStrokes = (
  from: readonly Stroke[],
  to: readonly Stroke[],
  progress: number,
): readonly Stroke[] => {
  if (progress >= 1 || !sameShape(from, to)) return to;
  const tidying = easeInOut(Math.min(1, progress / TIDY_SHARE));
  const tidied = from.map((stroke, index) => {
    const goal = to[index] ?? stroke;
    return stroke.map((point, at) => between(point, goal[at] ?? point, tidying));
  });
  const added = to.slice(from.length);
  const drawn = Math.max(0, (progress - TIDY_SHARE) / (1 - TIDY_SHARE)) * added.length;
  const drawing = added.flatMap((stroke, index) => {
    const share = Math.min(1, Math.max(0, drawn - index));
    const points = stroke.slice(0, Math.ceil(share * stroke.length));
    return points.length > 1 ? [points] : [];
  });
  return [...tidied, ...drawing];
};
