import { expandRect, type Rect, rectsOverlap, type Vec } from "../core/geometry";

/** Which way a note slides first when the spot it wanted is already written on. */
export type Drift = "up" | "down";

const BREATHING_ROOM = 6;
const MAX_STEPS = 6;

const clearOf = (candidate: Rect, taken: readonly Rect[]): boolean =>
  !taken.some((rect) => rectsOverlap(expandRect(candidate, BREATHING_ROOM), rect));

/**
 * The nearest top-left for `wanted` at which it overlaps none of `taken`: the spot itself, then
 * whole line-heights in the drift direction, then the other way. Falls back to the spot itself.
 */
export const settle = (wanted: Rect, taken: readonly Rect[], drift: Drift): Vec => {
  const origin = { x: wanted.x, y: wanted.y };
  if (clearOf(wanted, taken)) return origin;
  const step = (wanted.height + BREATHING_ROOM) * (drift === "up" ? -1 : 1);
  for (const direction of [1, -1]) {
    for (let i = 1; i <= MAX_STEPS; i++) {
      const y = wanted.y + direction * i * step;
      if (clearOf({ ...wanted, y }, taken)) return { x: wanted.x, y };
    }
  }
  return origin;
};
