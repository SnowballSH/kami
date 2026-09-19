import { describe, expect, it } from "vitest";
import { FixedStepLoop } from "./fixedStepLoop";

describe("FixedStepLoop", () => {
  it("carries the remainder between frames", () => {
    const loop = new FixedStepLoop(10, 5);
    expect(loop.advance(25)).toBe(2);
    expect(loop.advance(5)).toBe(1);
    expect(loop.advance(4)).toBe(0);
  });

  it("plays a 120 Hz display at the same speed as a 60 Hz one", () => {
    const fast = new FixedStepLoop(1000 / 60, 5);
    const frames = Array.from({ length: 120 }, () => fast.advance(1000 / 120));
    expect(frames.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(59);
    expect(frames.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60);
  });

  it("drops the backlog after a long stall instead of spiralling", () => {
    const loop = new FixedStepLoop(10, 5);
    expect(loop.advance(10_000)).toBe(5);
    expect(loop.advance(10)).toBe(1);
  });
});
