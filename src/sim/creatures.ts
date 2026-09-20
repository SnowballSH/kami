import Matter from "matter-js";
import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import {
  CREATURE_EDGE_DROP,
  CREATURE_LOOK_AHEAD,
  CREATURE_TURN_COOLDOWN_TICKS,
  CREATURE_WALK_SPEED,
  FLEE_HASTE,
  FLEE_RADIUS_PX,
  FLY_BOB_PERIOD_TICKS,
  FLY_BOB_SPEED,
  FLY_ROAM_PX,
  FLY_SPEED,
  HEEL_PX,
  HOP_FORWARD_SPEED,
  HOP_REACH,
  HOP_REST_TICKS,
  HOP_UP_SPEED,
  PERCH_ABOVE_PX,
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
  /** The height a flier is climbing to after touching ground; null once it is up. */
  liftTo: number | null;
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
  liftTo: null,
});

/** The world as a creature feels it: what its body would touch if nudged, and what lies under a point. */
export interface Feelers {
  touches(ink: InkEntity, offset: Vec): readonly Contact[];
  groundBelow(ink: InkEntity, foot: Vec, drop: number): boolean;
}

export const footing = (ink: InkEntity, feelers: Feelers): boolean =>
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

const face = (ink: InkEntity, direction: number): void => {
  if (direction !== 0) ink.mind.facing = direction > 0 ? 1 : -1;
};

const setVelocity = (ink: InkEntity, velocity: Vec): void => {
  Matter.Body.setVelocity(ink.body, velocity);
  Matter.Body.setAngularVelocity(ink.body, 0);
};

const carryAlice = (ink: InkEntity, world: NatureWorld, velocity: Vec): void => {
  if (world.alice.standsOn(ink.body)) world.alice.ride(velocity);
};

/**
 * What a creature's temper asks of it this tick: `heel` — it has caught up with Alice and waits;
 * `toward` — she is off and it goes after her; `away` — she is too close and it bolts; `roam` —
 * it has no temper, or she is far enough that a shy thing forgets her.
 */
export type Urge = "heel" | "toward" | "away" | "roam";

const aliceCentre = (world: NatureWorld): Vec => {
  const bounds = world.alice.bounds();
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};

export const urgeOf = (ink: InkEntity, world: NatureWorld): Urge => {
  if (ink.temper === null) return "roam";
  const gap = aliceCentre(world).x - ink.body.position.x;
  if (ink.temper === "follows") {
    if (Math.abs(gap) <= HEEL_PX) return "heel";
    face(ink, gap);
    return "toward";
  }
  if (Math.abs(gap) > FLEE_RADIUS_PX) return "roam";
  face(ink, -gap);
  return "away";
};

const haste = (urge: Urge): number => (urge === "away" ? FLEE_HASTE : 1);

/** How quick it is right now: its own pace under the laws, and its hurry to get away. */
const quickness = (ink: InkEntity, urge: Urge): number => ink.motion.pace * haste(urge);

/**
 * Paces its ground, turning at walls and at drops. A follower stops short of a drop and waits
 * there for Alice rather than turn its back on her; a fleer turns, and so can be cornered.
 */
export const walk = (ink: InkEntity, world: NatureWorld): void => {
  const { mind } = ink;
  mind.clock++;
  if (!footing(ink, world.feelers)) return;
  const urge = urgeOf(ink, world);
  const fall = Matter.Body.getVelocity(ink.body).y;
  const blocked =
    wallAhead(ink, world.feelers) || edgeAhead(ink, world.feelers, CREATURE_LOOK_AHEAD);
  if (urge === "heel" || (urge === "toward" && blocked)) {
    setVelocity(ink, { x: 0, y: fall });
    carryAlice(ink, world, { x: 0, y: 0 });
    return;
  }
  if (blocked) turnAround(ink);
  const velocity = {
    x: mind.facing * CREATURE_WALK_SPEED * ink.strength * quickness(ink, urge),
    y: fall,
  };
  setVelocity(ink, velocity);
  carryAlice(ink, world, { x: velocity.x, y: 0 });
};

/**
 * Sits, then springs forward on a beat; looks before each leap. A follower leaps after Alice
 * without looking, gaps and all; a fleer rests half as long.
 */
export const hop = (ink: InkEntity, world: NatureWorld): void => {
  const { mind } = ink;
  mind.clock++;
  if (!footing(ink, world.feelers)) {
    mind.rested = 0;
    return;
  }
  mind.rested++;
  const urge = urgeOf(ink, world);
  const rest = urge === "away" ? HOP_REST_TICKS / 2 : HOP_REST_TICKS;
  if (urge === "heel" || mind.rested < rest) {
    setVelocity(ink, { x: 0, y: Matter.Body.getVelocity(ink.body).y });
    return;
  }
  if (
    urge !== "toward" &&
    (wallAhead(ink, world.feelers) || edgeAhead(ink, world.feelers, HOP_REACH))
  ) {
    turnAround(ink);
  }
  setVelocity(ink, {
    x: mind.facing * HOP_FORWARD_SPEED * Math.sqrt(ink.strength) * quickness(ink, urge),
    y: -HOP_UP_SPEED * Math.sqrt(ink.strength),
  });
};

const bob = (mind: Mind): number =>
  FLY_BOB_SPEED * Math.sin((mind.clock / FLY_BOB_PERIOD_TICKS) * Math.PI * 2);

/** Bobs in the air; from the ground, climbs to a perch's height first. */
const rise = (ink: InkEntity, world: NatureWorld): number => {
  const { mind, body } = ink;
  if (footing(ink, world.feelers)) mind.liftTo = body.position.y - PERCH_ABOVE_PX;
  if (mind.liftTo !== null && body.position.y <= mind.liftTo) mind.liftTo = null;
  return mind.liftTo === null ? bob(mind) : -FLY_SPEED * ink.strength * ink.motion.pace;
};

/** Makes for a perch just above Alice's head, and hovers there once it arrives. */
const flyToAlice = (ink: InkEntity, world: NatureWorld): Vec => {
  const alice = world.alice.bounds();
  const perch = { x: alice.x + alice.width / 2, y: alice.y - PERCH_ABOVE_PX };
  const dx = perch.x - ink.body.position.x;
  const dy = perch.y - ink.body.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= HEEL_PX) return { x: 0, y: bob(ink.mind) };
  const speed = FLY_SPEED * ink.strength * ink.motion.pace;
  return { x: (dx / distance) * speed, y: (dy / distance) * speed + bob(ink.mind) };
};

/**
 * Flies level, bobbing, and roams only so far from where it was drawn before turning back. A
 * follower forgets its patch and keeps a perch above Alice; a fleer forgets it too, while she is
 * near.
 */
export const fly = (ink: InkEntity, world: NatureWorld): void => {
  const { mind, body } = ink;
  mind.clock++;
  cancelGravity(body, world.gravity);
  const urge = urgeOf(ink, world);
  if (urge === "toward") {
    const velocity = flyToAlice(ink, world);
    face(ink, velocity.x);
    setVelocity(ink, velocity);
    carryAlice(ink, world, velocity);
    return;
  }
  const strayed = body.position.x - ink.origin.x;
  const wandered = urge === "roam" && Math.abs(strayed) > FLY_ROAM_PX && strayed * mind.facing > 0;
  if (wallAhead(ink, world.feelers) || wandered) turnAround(ink);
  const velocity = {
    x: mind.facing * FLY_SPEED * ink.strength * quickness(ink, urge),
    y: rise(ink, world),
  };
  setVelocity(ink, velocity);
  carryAlice(ink, world, velocity);
};
