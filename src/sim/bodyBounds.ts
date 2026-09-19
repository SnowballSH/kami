import type Matter from "matter-js";
import { boundsOf, type Rect, type Vec } from "../core/geometry";

/** `body.bounds` is padded by velocity for the broadphase; this is the true silhouette. */
export const exactBounds = (body: Matter.Body): Rect =>
  boundsOf(
    body.parts.length > 1 ? body.parts.slice(1).flatMap((part) => part.vertices) : body.vertices,
  );

export const bottomOf = (rect: Rect): number => rect.y + rect.height;

/** Call before the engine update; matter-js clears forces after every step. */
export const cancelGravity = (body: Matter.Body, gravityPerMass: Vec): void => {
  body.force.x -= body.mass * gravityPerMass.x;
  body.force.y -= body.mass * gravityPerMass.y;
};
