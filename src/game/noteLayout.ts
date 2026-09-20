import { expandRect, type Rect, rectsOverlap, type Vec } from "../core/geometry";

/** Which way a note slides first when the spot it wanted is already written on. */
export type Drift = "up" | "down";

const BREATHING_ROOM = 6;
const PREFERRED_LINE_DISTANCE = 6;

const clearOf = (candidate: Rect, taken: readonly Rect[]): boolean =>
  !taken.some((rect) => rectsOverlap(expandRect(candidate, BREATHING_ROOM), rect));

export const settle = (
  wanted: Rect,
  taken: readonly Rect[],
  drift: Drift,
  minY = Number.NEGATIVE_INFINITY,
): Vec => {
  const origin = { x: wanted.x, y: Math.max(wanted.y, minY) };
  if (clearOf({ ...wanted, ...origin }, taken)) return origin;
  const edges = taken
    .flatMap((rect) => [
      rect.y - wanted.height - BREATHING_ROOM,
      rect.y + rect.height + BREATHING_ROOM,
    ])
    .filter((y) => y >= minY);
  const priority = (y: number): number => {
    const distance = y - origin.y;
    if (Math.abs(distance) > (wanted.height + BREATHING_ROOM) * PREFERRED_LINE_DISTANCE) return 2;
    return distance * (drift === "up" ? -1 : 1) >= 0 ? 0 : 1;
  };
  edges.sort(
    (a, b) => priority(a) - priority(b) || Math.abs(a - origin.y) - Math.abs(b - origin.y),
  );
  for (const y of edges) {
    if (clearOf({ ...wanted, y }, taken)) return { x: wanted.x, y };
  }
  return origin;
};
