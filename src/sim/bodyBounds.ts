import type Matter from "matter-js";
import { boundsOf, type Rect } from "../core/geometry";

/** `body.bounds` is padded by velocity for the broadphase; this is the true silhouette. */
export const exactBounds = (body: Matter.Body): Rect =>
  boundsOf(
    body.parts.length > 1 ? body.parts.slice(1).flatMap((part) => part.vertices) : body.vertices,
  );

export const bottomOf = (rect: Rect): number => rect.y + rect.height;

export const boundsRect = ({ min, max }: Matter.Bounds): Rect => ({
  x: min.x,
  y: min.y,
  width: max.x - min.x,
  height: max.y - min.y,
});
