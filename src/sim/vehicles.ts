import Matter from "matter-js";
import type { AliceController } from "./alice";
import { VEHICLE_ACCELERATION, VEHICLE_SPEED } from "./constants";
import { type Feelers, footing } from "./creatures";
import type { InkEntity } from "./inkEntity";
import type { NatureWorld } from "./natures";
import type { Gait, Ride } from "./types";

export const VEHICLE_KEEL = 0.9;

const approach = (current: number, target: number, step: number): number =>
  Math.abs(target - current) <= step ? target : current + Math.sign(target - current) * step;

/**
 * Boarding takes both feet over it; once aboard she stays the driver until she steps or jumps off.
 * Of several Alices standing on it, the first is at the wheel.
 */
const driverOf = (ink: InkEntity, world: NatureWorld): AliceController | null => {
  const { mind } = ink;
  const alice = world.alices.find((each) => each.standsOn(ink.body));
  if (alice === undefined) {
    mind.aboard = false;
    return null;
  }
  const { min, max } = ink.body.bounds;
  const { x, width } = alice.bounds();
  mind.aboard ||= x >= min.x && x + width <= max.x;
  return mind.aboard ? alice : null;
};

/**
 * A winged vehicle carries its driver up and down once it is off the ground, or rolling for take-off;
 * standing still on the ground it is a car she can jump off like any other.
 */
export const liftsHer = (ink: InkEntity, feelers: Feelers): boolean =>
  ink.motion.wings > 0 && ink.mind.aboard && (ink.mind.speed !== 0 || !footing(ink, feelers));

const gaitOf = (ink: InkEntity): Gait | null => {
  switch (ink.nature) {
    case "vehicle":
      return ink.mind.aboard ? "vehicle" : null;
    case "walker":
    case "hopper":
      return ink.motion.wings > 0 ? "flier" : ink.nature;
    case "flier":
      return "flier";
    default:
      return null;
  }
};

/** What an Alice with her feet on `ink` is riding: a vehicle only once she is its driver. */
export const rideOn = (ink: InkEntity): Ride | null => {
  const gait = gaitOf(ink);
  return gait === null ? null : { id: ink.id, gait };
};

/** Rolls where its driver points while an Alice is aboard; with nobody aboard it is just a body. */
export const drive = (ink: InkEntity, world: NatureWorld): void => {
  const { mind } = ink;
  const alice = driverOf(ink, world);
  if (alice === null) {
    mind.speed = 0;
    return;
  }
  const intent = world.intentOf(alice);
  const topSpeed = VEHICLE_SPEED * ink.strength * ink.motion.pace;
  mind.speed = approach(mind.speed, intent.x * topSpeed, VEHICLE_ACCELERATION * ink.motion.pace);
  const flying = liftsHer(ink, world.feelers);
  const falling = Matter.Body.getVelocity(ink.body).y;
  const velocity = { x: mind.speed, y: flying ? intent.y * topSpeed : falling };
  Matter.Body.setVelocity(ink.body, velocity);
  if (footing(ink, world.feelers)) {
    Matter.Body.setAngularVelocity(
      ink.body,
      Matter.Body.getAngularVelocity(ink.body) * VEHICLE_KEEL,
    );
    Matter.Body.setAngle(ink.body, ink.body.angle * 0.5);
  }
  alice.drive({ x: velocity.x, y: flying ? velocity.y : 0 });
};
