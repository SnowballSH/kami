import { distance, type PenPoint, type Vec } from "../core/geometry";
import { MIN_POINT_SPACING } from "./constants";

const lerp = (from: Vec, to: PenPoint, t: number): PenPoint => ({
  ...to,
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

export const nextInkPoint = (last: Vec, target: PenPoint, inkLeft: number): PenPoint | null => {
  const gap = distance(last, target);
  if (gap < MIN_POINT_SPACING || inkLeft <= 0) return null;
  return gap <= inkLeft ? target : lerp(last, target, inkLeft / gap);
};
