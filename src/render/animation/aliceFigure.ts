import { ALICE_POSES, type AlicePose, LIMBS } from "../alicePose";
import { lerp } from "./easing";

interface MutableVec {
  x: number;
  y: number;
}

export type MutablePose = { readonly [limb in keyof AlicePose]: MutableVec };

/** The last of her fading away where she was before she was carried off: ink running down the page. */
export interface Ghost {
  readonly center: MutableVec;
  alpha: number;
  /** How far her outline has run, as a fraction of her height. */
  drip: number;
  facing: number;
  width: number;
  height: number;
}

/**
 * How Alice is drawn this frame, on top of where the simulation says she is. Everything here
 * is presentation: the physics never see it. Reused frame to frame, so nothing is allocated.
 */
export interface AliceFigure {
  readonly pose: MutablePose;
  /** World px added to her centre. */
  readonly offset: MutableVec;
  /** Squash and stretch about her feet; 1 is her true size. */
  readonly stretch: MutableVec;
  /** -1 to 1; passing through 0 is the flip when she turns round. */
  facing: number;
  /** Radians she tilts about her feet, clockwise positive. */
  lean: number;
  alpha: number;
  /** How much of her is drawn, top down; 1 is all of her. */
  inked: number;
  /** Scale of the key in her hand, overshooting as she snatches it up. */
  keyScale: number;
  ghost: Ghost | null;
}

export const newPose = (from: AlicePose = ALICE_POSES.stand): MutablePose => ({
  frontHand: { ...from.frontHand },
  backHand: { ...from.backHand },
  frontKnee: { ...from.frontKnee },
  backKnee: { ...from.backKnee },
  frontFoot: { ...from.frontFoot },
  backFoot: { ...from.backFoot },
});

export const newFigure = (): AliceFigure => ({
  pose: newPose(),
  offset: { x: 0, y: 0 },
  stretch: { x: 1, y: 1 },
  facing: 1,
  lean: 0,
  alpha: 1,
  inked: 1,
  keyScale: 1,
  ghost: null,
});

export const copyPose = (out: MutablePose, from: AlicePose): void => {
  for (const limb of LIMBS) {
    out[limb].x = from[limb].x;
    out[limb].y = from[limb].y;
  }
};

/** Writes the pose `t` of the way from `from` to `to` into `out`; `out` may be either of them. */
export const mixPose = (out: MutablePose, from: AlicePose, to: AlicePose, t: number): void => {
  for (const limb of LIMBS) {
    out[limb].x = lerp(from[limb].x, to[limb].x, t);
    out[limb].y = lerp(from[limb].y, to[limb].y, t);
  }
};
