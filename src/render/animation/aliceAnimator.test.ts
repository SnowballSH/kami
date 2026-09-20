import { describe, expect, it } from "vitest";
import { idOf } from "../../sim/testSupport";
import { ALICE_BASE, type AliceSnapshot } from "../../sim/types";
import { ALICE_POSES } from "../alicePose";
import {
  AliceAnimator,
  type AliceCues,
  DISMOUNT_MS,
  DRIP_MS,
  HOP_MS,
  KEY_MS,
  LAND_MS,
  MAX_SQUASH,
  NO_CUES,
  POP_MS,
  PORTAL_ENTRY_MS,
  PORTAL_EXIT_MS,
  REINK_MS,
  SEAT_SINK,
  SWELL_MS,
  TURN_MS,
} from "./aliceAnimator";
import type { AliceFigure } from "./aliceFigure";

const CAR = { id: idOf("car"), gait: "vehicle" } as const;
const HORSE = { id: idOf("horse"), gait: "walker" } as const;
const RABBIT = { id: idOf("rabbit"), gait: "hopper" } as const;
const BIRD = { id: idOf("bird"), gait: "flier" } as const;

const STANDING: AliceSnapshot = {
  center: { x: 100, y: 100 },
  velocity: { x: 0, y: 0 },
  width: ALICE_BASE.width,
  height: ALICE_BASE.height,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
  look: { kind: "alice" },
};

const her = (changes: Partial<AliceSnapshot> = {}): AliceSnapshot => ({ ...STANDING, ...changes });

/** Feeds `frames` in order, a frame apart, and returns the figure after the last one. */
const play = (
  animator: AliceAnimator,
  frames: readonly AliceSnapshot[],
  startMs = 0,
  stepMs = 16,
): AliceFigure => {
  let figure: AliceFigure | null = null;
  frames.forEach((frame, index) => {
    figure = animator.observe(frame, NO_CUES, startMs + index * stepMs);
  });
  if (figure === null) throw new Error("no frames");
  return figure;
};

/** An animator that has already seen her standing still long enough to have settled. */
const settled = (alice = STANDING): AliceAnimator => {
  const animator = new AliceAnimator();
  animator.observe(alice, NO_CUES, -10_000);
  animator.observe(alice, NO_CUES, -9_000);
  return animator;
};

const snapshotOf = (figure: AliceFigure) => ({
  offset: { ...figure.offset },
  stretch: { ...figure.stretch },
  facing: figure.facing,
  lean: figure.lean,
  inked: figure.inked,
  keyScale: figure.keyScale,
  ghost: figure.ghost === null,
  frontKnee: { ...figure.pose.frontKnee },
});

const AT_REST = {
  offset: { x: 0, y: 0 },
  stretch: { x: 1, y: 1 },
  facing: 1,
  lean: 0,
  inked: 1,
  keyScale: 1,
  ghost: true,
};

describe("AliceAnimator at rest", () => {
  it("inks her in from the top the first time she is seen, then leaves her alone", () => {
    const animator = new AliceAnimator();
    expect(animator.observe(STANDING, NO_CUES, 0).inked).toBe(0);
    expect(animator.observe(STANDING, NO_CUES, REINK_MS / 2).inked).toBeCloseTo(0.5);
    const figure = animator.observe(STANDING, NO_CUES, REINK_MS);
    expect(snapshotOf(figure)).toMatchObject(AT_REST);
    expect(figure.pose.frontKnee).toEqual(ALICE_POSES.stand.frontKnee);
  });

  it("reuses one figure and one pose object frame after frame", () => {
    const animator = settled();
    const first = animator.observe(STANDING, NO_CUES, 0);
    const second = animator.observe(her({ walking: true }), NO_CUES, 16);
    expect(second).toBe(first);
    expect(second.pose).toBe(first.pose);
  });

  it("walks with the flipbook frames when nothing else is going on", () => {
    const animator = settled();
    const walking = her({ walking: true });
    expect(animator.observe(walking, NO_CUES, 0).pose.frontFoot).toEqual(
      ALICE_POSES.stride.frontFoot,
    );
    expect(animator.observe(walking, NO_CUES, 140).pose.frontFoot).toEqual(
      ALICE_POSES.pass.frontFoot,
    );
  });
});

describe("boarding and leaving a vehicle", () => {
  it("hops up in an arc and folds into the seat over the boarding beat", () => {
    const animator = settled();
    const standingKnee = { ...ALICE_POSES.stand.frontKnee };
    const start = animator.observe(her({ ride: CAR }), NO_CUES, 0);
    expect(start.offset.y).toBeCloseTo(SEAT_SINK * ALICE_BASE.height);
    expect(start.pose.frontKnee).toEqual(standingKnee);

    const midway = animator.observe(her({ ride: CAR }), NO_CUES, HOP_MS / 2);
    expect(midway.offset.y).toBeCloseTo((SEAT_SINK - 0.35) * ALICE_BASE.height);
    expect(midway.pose.frontKnee.x).toBeGreaterThan(standingKnee.x);
    expect(midway.pose.frontKnee.x).toBeLessThan(ALICE_POSES.seated.frontKnee.x);

    const seated = animator.observe(her({ ride: CAR }), NO_CUES, HOP_MS);
    expect(seated.offset.y).toBe(SEAT_SINK * ALICE_BASE.height);
    expect(seated.pose.frontKnee).toEqual(ALICE_POSES.seated.frontKnee);
    expect(seated.pose.frontHand).toEqual(ALICE_POSES.seated.frontHand);
  });

  it("leans back against the speed while driving", () => {
    const animator = settled(her({ ride: CAR }));
    const cruising = animator.observe(her({ ride: CAR, velocity: { x: 6, y: 0 } }), NO_CUES, 0);
    expect(cruising.lean).toBeLessThan(0);
    const reversing = animator.observe(her({ ride: CAR, velocity: { x: -6, y: 0 } }), NO_CUES, 16);
    expect(reversing.lean).toBeGreaterThan(0);
    const parked = animator.observe(her({ ride: CAR }), NO_CUES, 32);
    expect(parked.lean).toBe(0);
  });

  it("hops off and settles with a small squash on landing", () => {
    const animator = settled(her({ ride: CAR }));
    animator.observe(STANDING, NO_CUES, 0);
    const midHop = animator.observe(STANDING, NO_CUES, DISMOUNT_MS / 2);
    expect(midHop.offset.y).toBeCloseTo(-0.2 * ALICE_BASE.height);
    expect(midHop.stretch).toEqual({ x: 1, y: 1 });

    const landing = animator.observe(STANDING, NO_CUES, DISMOUNT_MS + 1);
    expect(landing.offset.y).toBe(0);
    expect(landing.stretch.y).toBeLessThan(1);
    expect(landing.stretch.x).toBeGreaterThan(1);

    const rested = animator.observe(STANDING, NO_CUES, DISMOUNT_MS + LAND_MS + 1);
    expect(snapshotOf(rested)).toMatchObject(AT_REST);
  });
});

describe("riding a creature", () => {
  it("leaps up into the astride pose", () => {
    const animator = settled();
    animator.observe(her({ ride: HORSE, grounded: false }), NO_CUES, 0);
    const midway = animator.observe(her({ ride: HORSE }), NO_CUES, HOP_MS / 2);
    expect(midway.offset.y).toBeLessThan(0);
    const astride = animator.observe(her({ ride: HORSE }), NO_CUES, HOP_MS);
    expect(astride.pose.frontKnee).toEqual(ALICE_POSES.astride.frontKnee);
    expect(astride.stretch).toEqual({ x: 1, y: 1 });
  });

  it("sways with a walker's stride only while it moves", () => {
    const animator = settled(her({ ride: HORSE }));
    const walking = her({ ride: HORSE, velocity: { x: 2, y: 0 } });
    const leans = [0, 130, 260, 390].map((ms) => animator.observe(walking, NO_CUES, ms).lean);
    expect(leans.some((lean) => lean > 0.01)).toBe(true);
    expect(leans.some((lean) => lean < -0.01)).toBe(true);
    expect(animator.observe(her({ ride: HORSE }), NO_CUES, 300).lean).toBe(0);
  });

  it("stretches as a hopper springs up and crouches as it comes down", () => {
    const animator = settled(her({ ride: RABBIT }));
    const rising = animator.observe(her({ ride: RABBIT, velocity: { x: 0, y: -5 } }), NO_CUES, 0);
    expect(rising.stretch.y).toBeGreaterThan(1);
    expect(rising.stretch.x).toBeLessThan(1);
    expect(rising.pose.frontKnee).toEqual(ALICE_POSES.astride.frontKnee);

    const falling = animator.observe(her({ ride: RABBIT, velocity: { x: 0, y: 5 } }), NO_CUES, 16);
    expect(falling.stretch.y).toBeLessThan(1);
    expect(falling.pose.backKnee.x).toBeLessThan(ALICE_POSES.astride.backKnee.x);
  });

  it("bobs up and down on a flier's wingbeats", () => {
    const animator = settled(her({ ride: BIRD }));
    const offsets = [0, 90, 180, 270, 360].map(
      (ms) => animator.observe(her({ ride: BIRD }), NO_CUES, ms).offset.y,
    );
    expect(Math.max(...offsets)).toBeGreaterThan(0.5);
    expect(Math.min(...offsets)).toBeLessThan(-0.5);
    for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(0.03 * 60);
  });
});

describe("landing", () => {
  it("squashes in proportion to how fast she hit and settles back", () => {
    const soft = settled();
    soft.observe(her({ grounded: false, velocity: { x: 0, y: 4 } }), NO_CUES, 0);
    const softLanding = soft.observe(STANDING, NO_CUES, 16);

    const hard = settled();
    hard.observe(her({ grounded: false, velocity: { x: 0, y: 10 } }), NO_CUES, 0);
    const hardLanding = hard.observe(STANDING, NO_CUES, 16);

    expect(softLanding.stretch.y).toBeCloseTo(1 - 4 * 0.03);
    expect(hardLanding.stretch.y).toBeCloseTo(1 - 10 * 0.03);
    expect(hardLanding.stretch.x).toBeGreaterThan(softLanding.stretch.x);
    expect(hardLanding.pose.frontKnee.x).toBeGreaterThan(softLanding.pose.frontKnee.x);

    const flattest = hardLanding.stretch.y;
    const halfway = hard.observe(STANDING, NO_CUES, 16 + LAND_MS / 2);
    expect(halfway.stretch.y).toBeGreaterThan(flattest);
    expect(halfway.stretch.y).toBeLessThan(1);
    expect(snapshotOf(hard.observe(STANDING, NO_CUES, 16 + LAND_MS))).toMatchObject(AT_REST);
  });

  it("caps the squash on the hardest falls and ignores stepping down a kerb", () => {
    const plummet = settled();
    plummet.observe(her({ grounded: false, velocity: { x: 0, y: 40 } }), NO_CUES, 0);
    expect(plummet.observe(STANDING, NO_CUES, 16).stretch.y).toBeCloseTo(1 - MAX_SQUASH);

    const kerb = settled();
    kerb.observe(her({ grounded: false, velocity: { x: 0, y: 1 } }), NO_CUES, 0);
    expect(kerb.observe(STANDING, NO_CUES, 16).stretch).toEqual({ x: 1, y: 1 });
  });
});

describe("turning round", () => {
  it("flips through edge-on with a lean into the new direction instead of snapping", () => {
    const animator = settled();
    const turned = her({ facing: -1 });
    const start = animator.observe(turned, NO_CUES, 0);
    expect(start.facing).toBe(1);
    const midway = animator.observe(turned, NO_CUES, TURN_MS / 2);
    expect(Math.abs(midway.facing)).toBeLessThan(0.1);
    expect(midway.facing).not.toBe(0);
    expect(midway.lean).toBeLessThan(0);
    const done = animator.observe(turned, NO_CUES, TURN_MS);
    expect(done.facing).toBe(-1);
    expect(done.lean).toBe(0);
  });
});

describe("growing and shrinking", () => {
  it("puffs out sideways while growing and draws in while shrinking, then settles", () => {
    const growing = settled();
    growing.observe(her({ headingScale: 2 }), NO_CUES, 0);
    const puffed = growing.observe(her({ headingScale: 2 }), NO_CUES, SWELL_MS / 2);
    expect(puffed.stretch.x).toBeGreaterThan(1);
    expect(puffed.stretch.y).toBeLessThan(1);
    expect(growing.observe(her({ headingScale: 2 }), NO_CUES, SWELL_MS).stretch).toEqual({
      x: 1,
      y: 1,
    });

    const shrinking = settled();
    shrinking.observe(her({ headingScale: 0.5 }), NO_CUES, 0);
    const drawn = shrinking.observe(her({ headingScale: 0.5 }), NO_CUES, SWELL_MS / 2);
    expect(drawn.stretch.x).toBeLessThan(1);
    expect(drawn.stretch.y).toBeGreaterThan(1);
  });
});

describe("being carried off", () => {
  const FAR = her({ center: { x: 2000, y: 100 } });
  const WARPED: AliceCues = { warped: true, devoured: false };
  const DEVOURED: AliceCues = { warped: false, devoured: true };

  it("pops out of a portal from small, overshooting, with nothing left behind", () => {
    const animator = settled();
    const out = animator.observe(FAR, WARPED, 0);
    expect(out.stretch.x).toBeCloseTo(0.2);
    expect(out.ghost).toBeNull();
    const overshoot = animator.observe(FAR, NO_CUES, POP_MS * 0.7);
    expect(overshoot.stretch.x).toBeGreaterThan(1);
    expect(snapshotOf(animator.observe(FAR, NO_CUES, POP_MS))).toMatchObject(AT_REST);
  });

  it("shrinks and spins into the entry portal before growing out of the exit", () => {
    const animator = settled();
    const exit = her({ center: { x: 500, y: 100 } });
    const warp: AliceCues = {
      warped: false,
      devoured: false,
      warp: { from: { x: 100, y: 100 }, to: exit.center },
    };
    const entering = animator.observe(exit, warp, 0);
    expect(entering.offset.x).toBeCloseTo(-400);
    expect(entering.stretch.x).toBeCloseTo(1);

    const shrinking = animator.observe(exit, NO_CUES, PORTAL_ENTRY_MS / 2);
    expect(shrinking.stretch.x).toBeLessThan(1);
    expect(shrinking.lean).toBeGreaterThan(0);

    const inRing = animator.observe(exit, NO_CUES, PORTAL_ENTRY_MS - 1);
    expect(inRing.stretch.x).toBeLessThan(0.24);
    expect(inRing.offset.x).toBeCloseTo(-400, 0);

    const overshoot = animator.observe(exit, NO_CUES, PORTAL_ENTRY_MS + PORTAL_EXIT_MS * 0.7);
    expect(overshoot.stretch.x).toBeGreaterThan(1);
    expect(overshoot.lean).toBeGreaterThan(0);
    expect(
      snapshotOf(
        animator.observe(exit, NO_CUES, PORTAL_ENTRY_MS + PORTAL_EXIT_MS + DRIP_MS),
      ),
    ).toMatchObject(AT_REST);
  });

  it("leaves her old self dripping away where she fell and re-inks her at the checkpoint", () => {
    const animator = settled();
    const gone = animator.observe(FAR, NO_CUES, 0);
    expect(gone.inked).toBe(0);
    expect(gone.ghost).not.toBeNull();
    expect(gone.ghost?.center).toEqual(STANDING.center);
    expect(gone.ghost?.alpha).toBe(1);
    expect(gone.ghost?.drip).toBe(0);

    const dripping = animator.observe(FAR, NO_CUES, DRIP_MS / 2);
    expect(dripping.ghost?.alpha).toBeCloseTo(0.5);
    expect(dripping.ghost?.drip).toBeGreaterThan(0);
    expect(dripping.inked).toBeGreaterThan(0);
    expect(dripping.inked).toBeLessThan(1);

    expect(animator.observe(FAR, NO_CUES, DRIP_MS).ghost).toBeNull();
    expect(snapshotOf(animator.observe(FAR, NO_CUES, REINK_MS))).toMatchObject(AT_REST);
  });

  it("leaves nothing behind when the Sumikui swallowed her, since she has already faded", () => {
    const animator = settled();
    const gone = animator.observe(FAR, DEVOURED, 0);
    expect(gone.ghost).toBeNull();
    expect(gone.inked).toBe(0);
  });

  it("drops any hop or squash in flight, since the place they belonged to is gone", () => {
    const animator = settled();
    animator.observe(her({ ride: CAR }), NO_CUES, 0);
    const gone = animator.observe(FAR, WARPED, HOP_MS / 2);
    expect(gone.offset.y).toBe(0);
  });
});

describe("picking up the key", () => {
  it("pops the key into her hand, overshooting, once she has it", () => {
    const animator = settled();
    const grabbed = animator.observe(her({ hasKey: true }), NO_CUES, 0);
    expect(grabbed.keyScale).toBeCloseTo(0);
    const swinging = animator.observe(her({ hasKey: true }), NO_CUES, KEY_MS * 0.7);
    expect(swinging.keyScale).toBeGreaterThan(1);
    expect(animator.observe(her({ hasKey: true }), NO_CUES, KEY_MS).keyScale).toBe(1);
  });
});

describe("a sequence of snapshots", () => {
  it("plays a jump onto a car as one continuous beat: air, hop into the seat, then still", () => {
    const animator = settled();
    const frames = [
      her({ grounded: false, velocity: { x: 3, y: -6 } }),
      her({ grounded: false, velocity: { x: 3, y: 2 } }),
      her({ ride: CAR, velocity: { x: 3, y: 0 } }),
    ];
    const boarding = play(animator, frames);
    expect(boarding.stretch).toEqual({ x: 1, y: 1 });
    expect(boarding.pose.frontHand).toEqual(ALICE_POSES.air.frontHand);
    const seated = animator.observe(frames[2] ?? STANDING, NO_CUES, 32 + HOP_MS);
    expect(seated.pose.frontHand).toEqual(ALICE_POSES.seated.frontHand);
  });
});
