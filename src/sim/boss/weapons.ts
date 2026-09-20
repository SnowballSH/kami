import { distanceToRect, type Vec } from "../../core/geometry";
import { boundsRect } from "../bodyBounds";
import type { InkEntity } from "../inkEntity";
import { TEAR_TUNING } from "./tuning";

export interface Blow {
  readonly damage: number;
  readonly from: Vec;
}

const SPINNING = 0.05;

const isHeavy = (ink: InkEntity): boolean => ink.nature === "heavy" || ink.motion.mass > 1;

const isSpinning = (ink: InkEntity): boolean =>
  ink.motion.spin !== 0 || Math.abs(ink.body.angularVelocity) > SPINNING;

/**
 * What a drawing does to a servant it touches: a hazard it was baited into burns it; anything
 * else must be moving to hurt — swung, thrown, or dropped on it — and hits harder heavy or spinning.
 */
export const blowFrom = (ink: InkEntity, at: Vec, radius: number): Blow | null => {
  if (distanceToRect(at, boundsRect(ink.body.bounds)) > radius) return null;
  const from = { x: ink.body.position.x, y: ink.body.position.y };
  if (ink.nature === "hazard") return { damage: TEAR_TUNING.hitDamage, from };
  const speed = Math.hypot(ink.body.velocity.x, ink.body.velocity.y);
  if (speed < TEAR_TUNING.weaponMinSpeed) return null;
  const damage =
    TEAR_TUNING.hitDamage *
    (isHeavy(ink) ? TEAR_TUNING.heavyMultiplier : 1) *
    (isSpinning(ink) ? TEAR_TUNING.spinMultiplier : 1);
  return { damage, from };
};
