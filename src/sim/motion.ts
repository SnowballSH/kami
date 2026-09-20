import Matter from "matter-js";
import { FIXED_STEP_MS } from "../core/world";
import type { InkEntity } from "./inkEntity";
import { NATURES } from "./natures";
import { accelerationOf, push } from "./worldPhysics";

const MS_PER_SECOND = 1000;
const RADIANS_PER_TURN = 2 * Math.PI;

const radiansPerStep = (turnsPerSecond: number): number =>
  (turnsPerSecond * RADIANS_PER_TURN * FIXED_STEP_MS) / MS_PER_SECOND;

const spin = (ink: InkEntity): void => {
  const { body, motion } = ink;
  if (motion.spin === 0 || NATURES[ink.nature].upright) return;
  if (body.isStatic) {
    if (!NATURES[ink.nature].pinned) {
      Matter.Body.setAngle(body, body.angle + radiansPerStep(motion.spin));
    }
    return;
  }
  Matter.Body.setAngularVelocity(body, radiansPerStep(motion.spin));
};

const thrust = ({ body, motion }: InkEntity): void => {
  if (body.isStatic || (motion.thrust.x === 0 && motion.thrust.y === 0)) return;
  push(body, accelerationOf(motion.thrust));
};

/**
 * The motion system: before each engine step, every drawing with a `spin` turns (a held one in
 * place, a loose one by its angular velocity) and every loose one with a `thrust` pushes itself.
 * Creatures keep their feet; roles stay where they were drawn.
 */
export const moveOfItself = (inks: readonly InkEntity[]): void => {
  for (const ink of inks) {
    spin(ink);
    thrust(ink);
  }
};
