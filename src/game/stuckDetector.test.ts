import { describe, expect, it } from "vitest";
import { StuckDetector } from "./stuckDetector";

describe("StuckDetector", () => {
  it("notices 45 seconds without progress", () => {
    const stuck = new StuckDetector();
    stuck.reset(1_000);
    expect(stuck.isStuck(45_999)).toBe(false);
    expect(stuck.isStuck(46_000)).toBe(true);
    stuck.progress(46_000);
    expect(stuck.isStuck(50_000)).toBe(false);
  });

  it("notices three falls", () => {
    const stuck = new StuckDetector();
    stuck.reset(0);
    stuck.fell();
    stuck.fell();
    expect(stuck.isStuck(10)).toBe(false);
    stuck.fell();
    expect(stuck.isStuck(10)).toBe(true);
  });
});
