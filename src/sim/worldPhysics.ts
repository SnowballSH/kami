import Matter from "matter-js";
import type { Vec } from "../core/geometry";
import type { Motion, WorldPhysics } from "../rules/types";
import { GRAVITY_SCALE, MAX_AIR_FRICTION } from "./constants";

export interface BodyMaterial {
  readonly density: number;
  readonly friction: number;
  readonly frictionAir: number;
  readonly restitution: number;
}

/** Converts a field measured in g into what matter-js adds to velocity per ms². */
export const accelerationOf = (fieldInG: Vec): Vec => ({
  x: fieldInG.x * GRAVITY_SCALE,
  y: fieldInG.y * GRAVITY_SCALE,
});

export const airFrictionUnder = (physics: WorldPhysics, baseAirFriction: number): number =>
  Math.min(baseAirFriction * physics.airDrag, MAX_AIR_FRICTION);

export const materialUnder = (physics: WorldPhysics, base: BodyMaterial): BodyMaterial => ({
  density: base.density,
  friction: base.friction * physics.friction,
  frictionAir: airFrictionUnder(physics, base.frictionAir),
  restitution: physics.bounciness,
});

/** A drawing's own dials, over the world's: heavier, grippier, bouncier than the paper around it. */
export const materialMoved = (material: BodyMaterial, motion: Motion): BodyMaterial => ({
  ...material,
  density: material.density * motion.mass,
  friction: material.friction * motion.grip,
  restitution: Math.max(material.restitution, motion.bounce),
});

export const retune = (body: Matter.Body, material: BodyMaterial): void => {
  body.friction = material.friction;
  body.frictionAir = material.frictionAir;
  body.restitution = material.restitution;
  if (!body.isStatic && body.density !== material.density)
    Matter.Body.setDensity(body, material.density);
};

/** Call before the engine update; matter-js clears forces after every step. */
export const push = (body: Matter.Body, acceleration: Vec): void => {
  body.force.x += body.mass * acceleration.x;
  body.force.y += body.mass * acceleration.y;
};

export const cancelGravity = (body: Matter.Body, gravity: Vec): void =>
  push(body, { x: -gravity.x, y: -gravity.y });
