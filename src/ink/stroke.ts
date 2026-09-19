import { distance, type Vec } from "../core/geometry";
import { MIN_POINT_SPACING } from "./constants";

const lerp = (from: Vec, to: Vec, t: number): Vec => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

export const nextInkPoint = (last: Vec, target: Vec, inkLeft: number): Vec | null => {
  const gap = distance(last, target);
  if (gap < MIN_POINT_SPACING || inkLeft <= 0) return null;
  return gap <= inkLeft ? target : lerp(last, target, inkLeft / gap);
};
