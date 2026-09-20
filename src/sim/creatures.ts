import Matter from "matter-js";
import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import {
  CREATURE_EDGE_DROP,
  CREATURE_LOOK_AHEAD,
  CREATURE_TURN_COOLDOWN_TICKS,
  CREATURE_WALK_SPEED,
  FLY_BOB_PERIOD_TICKS,
  FLY_BOB_SPEED,
  FLY_ROAM_PX,
  FLY_SPEED,
  HOP_FORWARD_SPEED,
  HOP_REACH,
  HOP_REST_TICKS,
  HOP_UP_SPEED,
  PROBE_AHEAD,
  PROBE_BELOW,
} from "./constants";
import { blocks, type Contact } from "./contacts";
import type { InkEntity } from "./inkEntity";
import type { NatureWorld } from "./natures";
import { cancelGravity } from "./worldPhysics";

/** What a creature remembers between ticks. Reset whenever its ruling changes. */
export interface Mind {
  facing: -1 | 1;
  clock: number;
  turnedAt: number;
  /** Ticks spent standing since it last left the ground. */
  rested: number;
  /** A vehicle's road speed, signed; builds up and brakes a step per tick. */
  speed: number;
  /** Whether Alice is riding this vehicle. */
  aboard: boolean;
}

const hashOf = (id: DrawingId): number =>
  [...id].reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0, 7);

export const freshMind = (id: DrawingId): Mind => ({
  facing: hashOf(id) % 2 === 0 ? 1 : -1,
  clock: 0,
  turnedAt: Number.NEGATIVE_INFINITY,
  rested: 0,
  speed: 0,
  aboard: false,
});

/** The world as a creature feels it: what its body would touch if nudged, and what lies under a point. */
export interface Feelers {
  touches(ink: InkEntity, offset: Vec): readonly Contact[];
  groundBelow(ink: InkEntity, foot: Vec, drop: number): boolean;
}

const footing = (ink: InkEntity, feelers: Feelers): boolean =>
  feelers.touches(ink, { x: 0, y: PROBE_BELOW }).length > 0;

const wallAhead = (ink: InkEntity, feelers: Feelers): boolean =>
  feelers
    .touches(ink, { x: ink.mind.facing * PROBE_AHEAD, y: 0 })
    .some((contact) => blocks(contact, ink.mind.facing));

/** Whether the ground gives out `reach` ahead of the front foot. */
const edgeAhead = (ink: InkEntity, feelers: Feelers, reach: number): boolean => {
  const { min, max } = ink.body.bounds;
  const toe = ink.mind.facing > 0 ? max.x + reach : min.x - reach;
  return !feelers.groundBelow(ink, { x: toe, y: max.y }, CREATURE_EDGE_DROP);
};

const turnAround = (ink: InkEntity): void => {
  const { mind } = ink;
  if (mind.clock - mind.turnedAt < CREATURE_TURN_COOLDOWN_TICKS) return;
  mind.facing = mind.facing === 1 ? -1 : 1;
  mind.turnedAt = mind.clock;
};

const setVelocity = (ink: InkEntity, velocity: Vec): void => {
  Matter.Body.setVelocity(ink.body, velocity);
  Matter.Body.setAngularVelocity(ink.body, 0);
};

const carryAlice = (ink: InkEntity, world: NatureWorld, velocity: Vec): void => {
  if (world.alice.standsOn(ink.body)) world.alice.ride(velocity);
};

/** Paces its ground, turning at walls, at drops and at Alice. */
export const walk = (ink: InkEntity, world: NatureWorld): void => {
  const { mind } = ink;
  mind.clock++;
  if (!footing(ink, world.feelers)) return;
  if (wallAhead(ink, world.feelers) || edgeAhead(ink, world.feelers, CREATURE_LOOK_AHEAD)) {
    turnAround(ink);
  }
  const velocity = {
    x: mind.facing * CREATURE_WALK_SPEED * ink.strength,
    y: Matter.Body.getVelocity(ink.body).y,
  };
  setVelocity(ink, velocity);
  carryAlice(ink, world, { x: velocity.x, y: 0 });
};

/** Sits, then springs forward on a beat; looks before each leap. */
export const hop = (ink: InkEntity, world: NatureWorld): void => {
  const { mind } = ink;
  mind.clock++;
  if (!footing(ink, world.feelers)) {
    mind.rested = 0;
    return;
  }
  mind.rested++;
  if (mind.rested < HOP_REST_TICKS) {
    setVelocity(ink, { x: 0, y: Matter.Body.getVelocity(ink.body).y });
    return;
  }
  if (wallAhead(ink, world.feelers) || edgeAhead(ink, world.feelers, HOP_REACH)) turnAround(ink);
  setVelocity(ink, {
    x: mind.facing * HOP_FORWARD_SPEED * Math.sqrt(ink.strength),
    y: -HOP_UP_SPEED * Math.sqrt(ink.strength),
  });
};

/** Flies level, bobbing, and roams only so far from where it was drawn before turning back. */
export const fly = (ink: InkEntity, world: NatureWorld): void => {
  const { mind, body } = ink;
  mind.clock++;
  const strayed = body.position.x - ink.origin.x;
  const heading = mind.facing;
  if (wallAhead(ink, world.feelers) || (Math.abs(strayed) > FLY_ROAM_PX && strayed * heading > 0)) {
    turnAround(ink);
  }
  const velocity = {
    x: mind.facing * FLY_SPEED * ink.strength,
    y: FLY_BOB_SPEED * Math.sin((mind.clock / FLY_BOB_PERIOD_TICKS) * Math.PI * 2),
  };
  cancelGravity(body, world.gravity);
  setVelocity(ink, velocity);
  carryAlice(ink, world, velocity);
};
