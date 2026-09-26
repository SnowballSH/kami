import type { PenPoint, Stroke } from "../core/geometry";

/** A drawing on its way from the player's ink to Kami's tidied version of it. */
export interface Retrace {
  readonly from: readonly Stroke[];
  readonly startedAtMs: number;
}

export const RETRACE_MS = 650;
const TIDY_SHARE = 0.6;

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const between = (a: PenPoint, b: PenPoint, t: number): PenPoint => ({
  ...(a.pressure === undefined ? {} : { pressure: a.pressure }),
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Each player's stroke once fully tidied, kept so a settled stroke is the same array frame after frame. */
const landedStrokes = new WeakMap<Stroke, { readonly goal: Stroke; readonly landed: Stroke }>();

const tidiedStroke = (stroke: Stroke, goal: Stroke, tidying: number): Stroke => {
  if (tidying < 1) return stroke.map((point, at) => between(point, goal[at] ?? point, tidying));
  const cached = landedStrokes.get(stroke);
  if (cached?.goal === goal) return cached.landed;
  const landed = stroke.map((point, at) => between(point, goal[at] ?? point, 1));
  landedStrokes.set(stroke, { goal, landed });
  return landed;
};

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
  const tidied = from.map((stroke, index) => tidiedStroke(stroke, to[index] ?? stroke, tidying));
  const added = to.slice(from.length);
  const drawn = Math.max(0, (progress - TIDY_SHARE) / (1 - TIDY_SHARE));
  return [...tidied, ...drawnIn(added, drawn)];
};

/** The first `progress` (0–1) of `strokes` as a pen would lay them down, one stroke after another. */
export const drawnIn = (strokes: readonly Stroke[], progress: number): readonly Stroke[] => {
  if (progress >= 1) return strokes;
  const reached = progress * strokes.length;
  return strokes.flatMap((stroke, index) => {
    const share = Math.min(1, Math.max(0, reached - index));
    const points = share >= 1 ? stroke : stroke.slice(0, Math.ceil(share * stroke.length));
    return points.length > 1 ? [points] : [];
  });
};

/** A drawing of Kami's own, appearing on the board stroke by stroke. */
export interface Arrival {
  readonly startedAtMs: number;
}

export const ARRIVAL_MS = 1800;

export const arrivalProgress = (arrival: Arrival, nowMs: number): number =>
  Math.min(1, Math.max(0, (nowMs - arrival.startedAtMs) / ARRIVAL_MS));
