import type { Vec } from "../core/geometry";
import type { AliceSnapshot } from "../sim/types";

export type AlicePoseName = "stand" | "wait" | "stride" | "pass" | "climb" | "air";

export interface AlicePose {
  readonly frontHand: Vec;
  readonly backHand: Vec;
  readonly frontFoot: Vec;
  readonly backFoot: Vec;
}

export type AliceMotion = Pick<AliceSnapshot, "walking" | "grounded" | "climbing">;

export const WALK_FRAME_MS = 140;

export const ALICE_POSES: Readonly<Record<AlicePoseName, AlicePose>> = {
  stand: {
    frontHand: { x: 8, y: 3 },
    backHand: { x: -8, y: 3 },
    frontFoot: { x: 4, y: 28.5 },
    backFoot: { x: -4, y: 28.5 },
  },
  wait: {
    frontHand: { x: 9, y: 7 },
    backHand: { x: -9, y: 7 },
    frontFoot: { x: 5, y: 28.5 },
    backFoot: { x: -5, y: 28.5 },
  },
  stride: {
    frontHand: { x: -7, y: 1 },
    backHand: { x: 9, y: 0 },
    frontFoot: { x: 9, y: 28.5 },
    backFoot: { x: -9, y: 27.5 },
  },
  pass: {
    frontHand: { x: 6, y: 4 },
    backHand: { x: -5, y: 4 },
    frontFoot: { x: 1, y: 28.5 },
    backFoot: { x: -2, y: 25 },
  },
  climb: {
    frontHand: { x: 8, y: -27 },
    backHand: { x: -6, y: -23 },
    frontFoot: { x: 5, y: 26 },
    backFoot: { x: -5, y: 28.5 },
  },
  air: {
    frontHand: { x: 13, y: -15 },
    backHand: { x: -13, y: -15 },
    frontFoot: { x: 8, y: 27 },
    backFoot: { x: -8, y: 27 },
  },
};

export const alicePoseName = (
  alice: AliceMotion,
  nowMs: number,
  waiting = false,
): AlicePoseName => {
  if (alice.climbing) return "climb";
  if (!alice.grounded) return "air";
  if (!alice.walking) return waiting ? "wait" : "stand";
  return Math.floor(nowMs / WALK_FRAME_MS) % 2 === 0 ? "stride" : "pass";
};
