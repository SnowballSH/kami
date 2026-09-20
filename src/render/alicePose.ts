import type { Vec } from "../core/geometry";
import type { AliceSnapshot } from "../sim/types";

export type AlicePoseName =
  | "stand"
  | "stride"
  | "pass"
  | "climb"
  | "air"
  | "seated"
  | "astride"
  | "crouch";

/** Where her hands, knees and feet are, in her base body box (28 by 60, origin at her middle). */
export interface AlicePose {
  readonly frontHand: Vec;
  readonly backHand: Vec;
  readonly frontKnee: Vec;
  readonly backKnee: Vec;
  readonly frontFoot: Vec;
  readonly backFoot: Vec;
}

export type Limb = keyof AlicePose;

export const LIMBS: readonly Limb[] = [
  "frontHand",
  "backHand",
  "frontKnee",
  "backKnee",
  "frontFoot",
  "backFoot",
];

export type AliceMotion = Pick<AliceSnapshot, "walking" | "grounded" | "climbing" | "ride">;

export const WALK_FRAME_MS = 140;

export const FRONT_HIP: Vec = { x: 3.5, y: 13 };
export const BACK_HIP: Vec = { x: -3.5, y: 13 };

const midway = (from: Vec, to: Vec): Vec => ({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });

interface Limbs {
  readonly frontHand: Vec;
  readonly backHand: Vec;
  readonly frontFoot: Vec;
  readonly backFoot: Vec;
  readonly frontKnee?: Vec;
  readonly backKnee?: Vec;
}

/** A pose whose knees, unless given, sit straight between hip and foot. */
const pose = (limbs: Limbs): AlicePose => ({
  frontHand: limbs.frontHand,
  backHand: limbs.backHand,
  frontKnee: limbs.frontKnee ?? midway(FRONT_HIP, limbs.frontFoot),
  backKnee: limbs.backKnee ?? midway(BACK_HIP, limbs.backFoot),
  frontFoot: limbs.frontFoot,
  backFoot: limbs.backFoot,
});

export const ALICE_POSES: Readonly<Record<AlicePoseName, AlicePose>> = {
  stand: pose({
    frontHand: { x: 8, y: 3 },
    backHand: { x: -8, y: 3 },
    frontFoot: { x: 4, y: 28.5 },
    backFoot: { x: -4, y: 28.5 },
  }),
  stride: pose({
    frontHand: { x: -7, y: 1 },
    backHand: { x: 9, y: 0 },
    frontFoot: { x: 9, y: 28.5 },
    backFoot: { x: -9, y: 27.5 },
  }),
  pass: pose({
    frontHand: { x: 6, y: 4 },
    backHand: { x: -5, y: 4 },
    frontFoot: { x: 1, y: 28.5 },
    backFoot: { x: -2, y: 25 },
  }),
  climb: pose({
    frontHand: { x: 9, y: -28 },
    backHand: { x: 13, y: -19 },
    frontFoot: { x: 5, y: 26 },
    backFoot: { x: -5, y: 28.5 },
  }),
  air: pose({
    frontHand: { x: 13, y: -15 },
    backHand: { x: -13, y: -15 },
    frontFoot: { x: 8, y: 27 },
    backFoot: { x: -8, y: 27 },
  }),
  /** At the wheel: knees up and forward, both hands on it. */
  seated: pose({
    frontHand: { x: 13, y: -3 },
    backHand: { x: 12, y: -1 },
    frontKnee: { x: 11, y: 17 },
    backKnee: { x: 9, y: 18 },
    frontFoot: { x: 13, y: 27 },
    backFoot: { x: 11, y: 28 },
  }),
  /** On a creature's back: legs hanging bent at its flanks, hands low on the reins. */
  astride: pose({
    frontHand: { x: 11, y: 2 },
    backHand: { x: 9, y: 4 },
    frontKnee: { x: 8, y: 20 },
    backKnee: { x: 6, y: 21 },
    frontFoot: { x: 6, y: 28.5 },
    backFoot: { x: 4, y: 28.5 },
  }),
  /** Knees bent wide and arms out for balance: the shape of a hard landing. */
  crouch: pose({
    frontHand: { x: 12, y: 9 },
    backHand: { x: -12, y: 9 },
    frontKnee: { x: 10, y: 21 },
    backKnee: { x: -10, y: 21 },
    frontFoot: { x: 7, y: 28.5 },
    backFoot: { x: -7, y: 28.5 },
  }),
};

export const alicePoseName = (alice: AliceMotion, nowMs: number): AlicePoseName => {
  if (alice.climbing) return "climb";
  if (alice.ride !== null) return alice.ride.gait === "vehicle" ? "seated" : "astride";
  if (!alice.grounded) return "air";
  if (!alice.walking) return "stand";
  return Math.floor(nowMs / WALK_FRAME_MS) % 2 === 0 ? "stride" : "pass";
};
