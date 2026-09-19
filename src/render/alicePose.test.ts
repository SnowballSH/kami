import { describe, expect, it } from "vitest";
import { ALICE_BASE } from "../sim/types";
import { ALICE_POSES, type AliceMotion, alicePoseName, WALK_FRAME_MS } from "./alicePose";

const STANDING: AliceMotion = { walking: false, grounded: true, climbing: false };

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
    expect(alicePoseName({ walking: true, grounded: false, climbing: true }, 0)).toBe("climb");
  });

  it("flails when she is off the ground", () => {
    expect(alicePoseName({ ...STANDING, grounded: false }, 0)).toBe("air");
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
});
