import type { Vec } from "../core/geometry";
import { FIXED_STEP_MS } from "../core/world";
import type { WorldPhysics } from "../rules/types";
import { ALICE_AIR_FRICTION, BOUNCE_SPEED, JUMP_SPEED, WALK_SPEED } from "./constants";
import type { BounceArc } from "./types";
import { accelerationOf, airFrictionUnder } from "./worldPhysics";

const ARC_TICK_LIMIT = 100_000;

/** Only gravity along the paper's down slows a jump straight up; its sideways part is drift, not pull. */
const pullPerTick = (gravity: Vec): number => gravity.y * FIXED_STEP_MS * FIXED_STEP_MS;

/** Replays matter-js's per-tick velocity update for a body thrown straight up, so the planner sees the same arc Alice will fly. */
export const traceArc = (speed: number, pull: number, drag: number): BounceArc => {
  const heights: number[] = [0];
  let velocity = -speed;
  let height = 0;
  let apexPx = 0;
  let ticksToApex = 0;
  while (heights.length < ARC_TICK_LIMIT) {
    velocity = velocity * (1 - drag) + pull;
    height -= velocity;
    if (height <= 0) break;
    heights.push(height);
    if (height > apexPx) {
      apexPx = height;
      ticksToApex = heights.length - 1;
    }
  }
  const unbounded = heights.length >= ARC_TICK_LIMIT;
  return {
    apexPx: unbounded ? Number.POSITIVE_INFINITY : apexPx,
    ticksToApex: unbounded ? Number.POSITIVE_INFINITY : ticksToApex,
    ticksAloftAbove: (risePx) => {
      if (risePx > apexPx) return null;
      for (let tick = heights.length - 1; tick >= 0; tick--) {
        if ((heights[tick] ?? 0) >= risePx) return tick;
      }
      return null;
    },
  };
};

const arcUnder = (physics: WorldPhysics, speed: number): BounceArc =>
  traceArc(
    speed,
    pullPerTick(accelerationOf(physics.gravity)),
    airFrictionUnder(physics, ALICE_AIR_FRICTION),
  );

export const bounceArcUnder = (physics: WorldPhysics, strength: number): BounceArc =>
  arcUnder(physics, BOUNCE_SPEED * Math.sqrt(strength));

/** Speeds grow with the square root of her scale, so a big Alice covers proportionally more ground. */
export const walkSpeedAt = (scale: number, pace = 1): number =>
  WALK_SPEED * Math.sqrt(scale) * pace;

export const jumpSpeedAt = (scale: number): number => JUMP_SPEED * Math.sqrt(scale);

export const jumpArcUnder = (physics: WorldPhysics, scale: number): BounceArc =>
  arcUnder(physics, jumpSpeedAt(scale));
