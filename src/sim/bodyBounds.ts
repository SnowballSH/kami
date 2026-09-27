import type Matter from "matter-js";
import { boundsOf, type Rect } from "../core/geometry";

/** `body.bounds` is padded by velocity for the broadphase; this is the true silhouette. */
export const exactBounds = (body: Matter.Body): Rect => {
  const { parts } = body;
  if (parts.length === 1) return boundsOf(body.vertices);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let at = 1; at < parts.length; at++) {
    for (const { x, y } of parts[at]?.vertices ?? []) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const bottomOf = (rect: Rect): number => rect.y + rect.height;

export const boundsRect = ({ min, max }: Matter.Bounds): Rect => ({
  x: min.x,
  y: min.y,
  width: max.x - min.x,
  height: max.y - min.y,
});
