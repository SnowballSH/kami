import { describe, expect, it } from "vitest";
import { idOf } from "../sim/testSupport";
import { ALICE_BASE } from "../sim/types";
import {
  ALICE_POSES,
  type AliceMotion,
  alicePoseName,
  BACK_HIP,
  FRONT_HIP,
  WALK_FRAME_MS,
} from "./alicePose";

const STANDING: AliceMotion = { walking: false, grounded: true, climbing: false, ride: null };

describe("alicePoseName", () => {
  it("stands still when she is not walking", () => {
    expect(alicePoseName(STANDING, 0)).toBe("stand");
    expect(alicePoseName(STANDING, WALK_FRAME_MS)).toBe("stand");
  });

  it("flips between two frames while walking", () => {
    const walking = { ...STANDING, walking: true };
    expect(alicePoseName(walking, 0)).toBe("stride");
    expect(alicePoseName(walking, WALK_FRAME_MS)).toBe("pass");
    expect(alicePoseName(walking, WALK_FRAME_MS * 2)).toBe("stride");
  });

  it("puts her arms up on a ladder, even mid-air", () => {
    expect(alicePoseName({ walking: true, grounded: false, climbing: true, ride: null }, 0)).toBe(
      "climb",
    );
  });

  it("flails when she is off the ground", () => {
    expect(alicePoseName({ ...STANDING, grounded: false }, 0)).toBe("air");
  });

  it("sits at the wheel of a vehicle and astride a creature, walking or not", () => {
    const car = { id: idOf("car"), gait: "vehicle" } as const;
    expect(alicePoseName({ ...STANDING, ride: car }, 0)).toBe("seated");
    expect(alicePoseName({ ...STANDING, walking: true, ride: car }, 0)).toBe("seated");
    for (const gait of ["walker", "hopper", "flier"] as const) {
      expect(alicePoseName({ ...STANDING, ride: { id: idOf("pet"), gait } }, 0)).toBe("astride");
    }
  });
});

describe("ALICE_POSES", () => {
  it("keeps every limb inside her body box", () => {
    const limbs = Object.values(ALICE_POSES).flatMap((pose) => Object.values(pose));
    for (const limb of limbs) {
      expect(Math.abs(limb.x)).toBeLessThanOrEqual(ALICE_BASE.width / 2);
      expect(Math.abs(limb.y)).toBeLessThanOrEqual(ALICE_BASE.height / 2);
    }
  });

  it("keeps her legs straight when she stands, and bends them when she sits", () => {
    const { stand, seated, astride } = ALICE_POSES;
    expect(stand.frontKnee).toEqual({
      x: (FRONT_HIP.x + stand.frontFoot.x) / 2,
      y: (FRONT_HIP.y + stand.frontFoot.y) / 2,
    });
    expect(stand.backKnee.x).toBe((BACK_HIP.x + stand.backFoot.x) / 2);
    for (const sitting of [seated, astride]) {
      expect(sitting.frontKnee.x).toBeGreaterThan(FRONT_HIP.x + 2);
      expect(sitting.frontKnee.y).toBeGreaterThan(FRONT_HIP.y);
      expect(sitting.frontKnee.y).toBeLessThan(sitting.frontFoot.y);
    }
  });
});
