import { describe, expect, it } from "vitest";
import { SteppedTurn, TURN_SETTLE_MS, TURN_STEP_DEGREES } from "./steppedTurn";

const FRAME_MS = 16;

/** The page spinning at `degreesPerFrame`, shown for `frames` frames; returns every angle shown. */
const spin = (turn: SteppedTurn, degreesPerFrame: number, frames: number, smooth: boolean) =>
  Array.from({ length: frames }, (_, frame) =>
    turn.follow(frame * degreesPerFrame, frame * FRAME_MS, smooth),
  );

describe("SteppedTurn", () => {
  it("follows the paper every frame when motion is allowed", () => {
    const shown = spin(new SteppedTurn(), 0.5, 100, true);
    expect(shown).toEqual(Array.from({ length: 100 }, (_, frame) => frame * 0.5));
  });

  it("shows a spinning page only in steps of at least the step size", () => {
    const shown = spin(new SteppedTurn(), 0.5, 100, false);
    const jumps = shown.flatMap((angle, frame) =>
      frame > 0 && angle !== shown[frame - 1] ? [angle - (shown[frame - 1] ?? 0)] : [],
    );
    expect(jumps.length).toBeGreaterThan(1);
    for (const jump of jumps) expect(jump).toBeGreaterThanOrEqual(TURN_STEP_DEGREES);
    expect(Math.abs((shown.at(-1) ?? 0) - 99 * 0.5)).toBeLessThan(TURN_STEP_DEGREES);
  });

  it("steps across the half-turn the short way round", () => {
    const turn = new SteppedTurn();
    turn.follow(175, 0, false);
    expect(turn.follow(-178, FRAME_MS, false)).toBe(175);
    expect(turn.follow(-170, 2 * FRAME_MS, false)).toBe(-170);
  });

  it("settles exactly on a small tilt once the page holds still", () => {
    const turn = new SteppedTurn();
    expect(turn.follow(0, 0, false)).toBe(0);
    expect(turn.follow(10, FRAME_MS, false)).toBe(0);
    expect(turn.follow(10, FRAME_MS + TURN_SETTLE_MS - 1, false)).toBe(0);
    expect(turn.follow(10, FRAME_MS + TURN_SETTLE_MS, false)).toBe(10);
  });

  it("jumps straight to a large tilt", () => {
    const turn = new SteppedTurn();
    turn.follow(0, 0, false);
    expect(turn.follow(90, FRAME_MS, false)).toBe(90);
  });
});
