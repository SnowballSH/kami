import { distance, lerpVec, type PenPoint, type Vec } from "../core/geometry";
import { MIN_POINT_SPACING } from "./constants";

export const nextInkPoint = (last: Vec, target: PenPoint, inkLeft: number): PenPoint | null => {
  const gap = distance(last, target);
  if (gap < MIN_POINT_SPACING || inkLeft <= 0) return null;
  return gap <= inkLeft ? target : { ...target, ...lerpVec(last, target, inkLeft / gap) };
};
