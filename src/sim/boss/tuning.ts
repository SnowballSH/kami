import type { BodyPartKind } from "../body/types";

/** Every number the boss fight is tuned by. The reasoning behind each is in docs/boss.md. */

export const BODY_TUNING = {
  heartRadius: 9,
  torsoHug: 0.2,
  legsBelow: 0.12,
  headAbove: 0.12,
  wingsOut: 0.3,
  namedWingsOut: 0.15,
  armsOut: 0.12,
  partAliveRatio: 0.5,
  graftReach: 14,
  graftGlowMs: 1_400,
} as const;

export const SNIPPER_RANKS = ["servant", "lesser"] as const;
export type SnipperRank = (typeof SNIPPER_RANKS)[number];

export interface SnipperTuning {
  readonly radius: number;
  readonly health: number;
  readonly orbitRadius: number;
  readonly orbitSpeed: number;
  readonly approachSpeed: number;
  readonly firstCircleMs: number;
  readonly circleMs: number;
  readonly windUpMs: number;
  readonly lungeMs: number;
  readonly recoverMs: number;
  readonly cutReach: number;
  readonly speedRampPerSnip: number;
  readonly maxSpeedRamp: number;
}

export const SNIPPER_TUNING: Readonly<Record<SnipperRank, SnipperTuning>> = {
  servant: {
    radius: 26,
    health: 100,
    orbitRadius: 150,
    orbitSpeed: 1.1,
    approachSpeed: 0.24,
    firstCircleMs: 4_800,
    circleMs: 2_600,
    windUpMs: 1_100,
    lungeMs: 260,
    recoverMs: 900,
    cutReach: 1.6,
    speedRampPerSnip: 0.06,
    maxSpeedRamp: 1.6,
  },
  lesser: {
    radius: 13,
    health: 30,
    orbitRadius: 105,
    orbitSpeed: 1.8,
    approachSpeed: 0.34,
    firstCircleMs: 3_200,
    circleMs: 1_900,
    windUpMs: 800,
    lungeMs: 200,
    recoverMs: 700,
    cutReach: 1.2,
    speedRampPerSnip: 0.04,
    maxSpeedRamp: 1.4,
  },
};

export const TEAR_TUNING = {
  aboveHeart: 220,
  entryDelayMs: 3_000,
  mercyMs: 2_600,
  waves: [
    { belowHealth: 0.6, lessers: 1 },
    { belowHealth: 0.3, lessers: 2 },
  ],
  hitInvulnerableMs: 500,
  perishMs: 900,
  weaponMinSpeed: 3,
  hitDamage: 12,
  heavyMultiplier: 2,
  spinMultiplier: 1.5,
  knockback: 9,
  cutFlashMs: 650,
  closingMs: 1_800,
} as const;

/** What the servant snips first: the limbs that let her run, then the rest, the heart last. */
export const SNIP_PRIORITY: readonly BodyPartKind[] = ["legs", "wings", "arms", "head", "torso"];
