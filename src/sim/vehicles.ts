import Matter from "matter-js";
import { VEHICLE_ACCELERATION, VEHICLE_SPEED } from "./constants";
import type { InkEntity } from "./inkEntity";
import type { NatureWorld } from "./natures";

const approach = (current: number, target: number, step: number): number =>
  Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;

/** Boarding takes both feet over it; once aboard she stays the driver until she steps or jumps off. */
const aboard = (ink: InkEntity, world: NatureWorld): boolean => {
  const { alice } = world;
  const { mind } = ink;
  if (!alice.standsOn(ink.body)) {
    mind.aboard = false;
    return false;
  }
  const { min, max } = ink.body.bounds;
  const { x, width } = alice.bounds();
  mind.aboard ||= x >= min.x && x + width <= max.x;
  return mind.aboard;
};

/** Rolls where its driver points while Alice is aboard; with nobody aboard it is just a body. */
export const drive = (ink: InkEntity, world: NatureWorld): void => {
  const { alice, intent } = world;
  const { mind } = ink;
  if (!aboard(ink, world)) {
    mind.speed = 0;
    return;
  }
  mind.speed = approach(mind.speed, intent.x * VEHICLE_SPEED * ink.strength, VEHICLE_ACCELERATION);
  const velocity = { x: mind.speed, y: Matter.Body.getVelocity(ink.body).y };
  Matter.Body.setVelocity(ink.body, velocity);
  Matter.Body.setAngularVelocity(ink.body, 0);
  alice.drive({ x: velocity.x, y: 0 });
};
