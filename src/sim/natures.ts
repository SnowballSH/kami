import Matter from "matter-js";
import type { Nature } from "../cat/types";
import type { Vec } from "../core/geometry";
import type { AliceController } from "./alice";
import { bottomOf } from "./bodyBounds";
import {
  BOUNCE_MAX_RISING_SPEED,
  BOUNCE_SPEED,
  FLOAT_DRIFT_DAMPING,
  FLOAT_SPEED,
  FLOAT_SPIN_DAMPING,
  HEAVY_DENSITY_FACTOR,
  INK_AIR_FRICTION,
  INK_DENSITY,
  INK_FRICTION,
  LIGHT_AIR_FRICTION,
  LIGHT_DENSITY_FACTOR,
} from "./constants";
import { type Contact, supports } from "./contacts";
import { type Feelers, fly, hop, walk } from "./creatures";
import type { InkEntity } from "./inkEntity";
import type { AliceSize, SimEvent, WalkIntent } from "./types";
import { drive } from "./vehicles";
import { floatLiftAt } from "./weather";
import { type BodyMaterial, cancelGravity } from "./worldPhysics";

/**
 * What a nature is allowed to do to the board it lives on. `alice` is the Alice the hook is about:
 * the one touching the ink, or, before a step, the nearest of them; `alices` is every one of her.
 */
export interface NatureWorld {
  readonly alice: AliceController;
  readonly alices: readonly AliceController[];
  readonly gravity: Vec;
  /** The air's temperature in °C. */
  readonly temperature: number;
  readonly feelers: Feelers;
  intentOf(alice: AliceController): WalkIntent;
  emit(event: SimEvent): void;
  reachGoal(): void;
  loseAlice(): void;
  consume(ink: InkEntity): void;
  freeze(ink: InkEntity): void;
  refuseGrowth(ink: InkEntity): void;
  hasHeadroomFor(size: AliceSize, meal: InkEntity): boolean;
  /** Pulls Alice and every loose drawing but `ink` itself toward `ink`, at `strengthInG` up close. */
  pullToward(ink: InkEntity, strengthInG: number): void;
  /** Sends Alice out of the portal drawn after `ink` (round to the first); nothing happens if it stands alone. */
  warp(ink: InkEntity): void;
}

type InkHook = (ink: InkEntity, world: NatureWorld) => void;
type AliceTouchHook = (ink: InkEntity, contact: Contact, world: NatureWorld) => void;

export interface NatureStrategy {
  /** Anchor clusters needed for the ink to hold still; `null` never holds. */
  readonly anchorsToHold: number | null;
  /** Roles stay exactly where they were drawn, whatever the ink has done since. */
  readonly pinned: boolean;
  readonly solidToAlice: boolean;
  readonly climbable: boolean;
  readonly slippery: boolean;
  /** Creatures keep their feet down: the body never rotates. */
  readonly upright: boolean;
  readonly material: (strength: number) => BodyMaterial;
  readonly beforeStep?: InkHook;
  readonly onAliceTouch?: AliceTouchHook;
  readonly onSurfaceTouch?: InkHook;
}

const PLAIN_MATERIAL: BodyMaterial = {
  density: INK_DENSITY,
  friction: INK_FRICTION,
  frictionAir: INK_AIR_FRICTION,
  restitution: 0,
};

const PLAIN: NatureStrategy = {
  anchorsToHold: 2,
  pinned: false,
  solidToAlice: true,
  climbable: false,
  slippery: false,
  upright: false,
  material: () => PLAIN_MATERIAL,
};

const CREATURE: NatureStrategy = { ...PLAIN, anchorsToHold: null, upright: true };

const ROLE: NatureStrategy = { ...PLAIN, anchorsToHold: 0, pinned: true };

const ATTRACTOR_PULL_G = 1.5;

const attract: InkHook = (ink, world) => world.pullToward(ink, ATTRACTOR_PULL_G * ink.strength);

const bounce: AliceTouchHook = (ink, contact, world) => {
  const { alice } = world;
  const feetAboveCentre = bottomOf(alice.bounds()) <= ink.body.position.y;
  const settling = alice.velocity.y >= -BOUNCE_MAX_RISING_SPEED;
  if (!supports(contact) || !feetAboveCentre || !settling) return;
  alice.launch(BOUNCE_SPEED * Math.sqrt(ink.strength));
  world.emit({ type: "bounced", drawingId: ink.id });
};

const rise: InkHook = (ink, world) => {
  const { body } = ink;
  const velocity = {
    x: Matter.Body.getVelocity(body).x * FLOAT_DRIFT_DAMPING,
    y: -FLOAT_SPEED * ink.strength * floatLiftAt(world.temperature),
  };
  cancelGravity(body, world.gravity);
  Matter.Body.setVelocity(body, velocity);
  Matter.Body.setAngularVelocity(body, body.angularVelocity * FLOAT_SPIN_DAMPING);
  for (const alice of world.alices) if (alice.standsOn(body)) alice.ride(velocity);
};

const resizeTo =
  (size: AliceSize): AliceTouchHook =>
  (ink, _contact, world) => {
    if (!world.hasHeadroomFor(size, ink)) {
      world.refuseGrowth(ink);
      return;
    }
    world.alice.beginResize(size);
    world.consume(ink);
    world.emit({ type: "consumed", drawingId: ink.id, nature: ink.nature });
  };

export const NATURES: Readonly<Record<Nature, NatureStrategy>> = {
  ink: PLAIN,
  bouncy: { ...PLAIN, onAliceTouch: bounce },
  climbable: { ...PLAIN, anchorsToHold: 1, solidToAlice: false, climbable: true },
  floaty: { ...PLAIN, anchorsToHold: null, beforeStep: rise },
  heavy: {
    ...PLAIN,
    material: (strength) => ({
      ...PLAIN_MATERIAL,
      density: INK_DENSITY * HEAVY_DENSITY_FACTOR * strength,
    }),
  },
  light: {
    ...PLAIN,
    material: () => ({
      ...PLAIN_MATERIAL,
      density: INK_DENSITY * LIGHT_DENSITY_FACTOR,
      frictionAir: LIGHT_AIR_FRICTION,
    }),
  },
  slippery: { ...PLAIN, slippery: true, material: () => ({ ...PLAIN_MATERIAL, friction: 0 }) },
  sticky: { ...PLAIN, anchorsToHold: 1, onSurfaceTouch: (ink, world) => world.freeze(ink) },
  grow: { ...PLAIN, onAliceTouch: resizeTo("big") },
  shrink: { ...PLAIN, onAliceTouch: resizeTo("small") },
  walker: { ...CREATURE, beforeStep: walk },
  hopper: { ...CREATURE, beforeStep: hop },
  flier: { ...CREATURE, beforeStep: fly },
  vehicle: { ...CREATURE, upright: false, beforeStep: drive },
  attractor: { ...ROLE, beforeStep: attract },
  lantern: PLAIN,
  portal: {
    ...ROLE,
    solidToAlice: false,
    onAliceTouch: (ink, _contact, world) => world.warp(ink),
  },
  solid: ROLE,
  goal: {
    ...ROLE,
    solidToAlice: false,
    onAliceTouch: (_ink, _contact, world) => world.reachGoal(),
  },
  hazard: { ...ROLE, onAliceTouch: (_ink, _contact, world) => world.loseAlice() },
  spawn: { ...ROLE, solidToAlice: false },
};

const hover: InkHook = (ink, world) => cancelGravity(ink.body, world.gravity);

/**
 * What the ink does of itself each tick. Wings, by law, lift it off the ground: a walker or hopper
 * flies, a vehicle hovers and its driver steers up and down too, anything else just hangs there.
 */
export const stepOf = (ink: InkEntity): InkHook | undefined => {
  const strategy = NATURES[ink.nature];
  if (ink.motion.wings <= 0 || ink.body.isStatic) return strategy.beforeStep;
  if (ink.nature === "walker" || ink.nature === "hopper") return fly;
  if (strategy.beforeStep === undefined) return hover;
  const step = strategy.beforeStep;
  return (target, world) => {
    hover(target, world);
    step(target, world);
  };
};

export const holdsStill = (strategy: NatureStrategy, anchorClusters: number): boolean =>
  strategy.anchorsToHold !== null && anchorClusters >= strategy.anchorsToHold;
