import { describe, expect, it } from "vitest";
import { type Rect, rectsOverlap } from "../core/geometry";
import { settle } from "./noteLayout";

const LINE: Rect = { x: 100, y: 200, width: 240, height: 30 };
const at = (y: number): Rect => ({ ...LINE, y });

describe("settle", () => {
  it("keeps a note where it was asked for when nothing is written there", () => {
    expect(settle(LINE, [at(400)], "up")).toEqual({ x: 100, y: 200 });
  });

  it("slides a remark up over writing already in its spot", () => {
    const taken = [at(200)];
    const placed = settle(LINE, taken, "up");

    expect(placed.y).toBeLessThan(200);
    expect(taken.some((rect) => rectsOverlap({ ...LINE, ...placed }, rect))).toBe(false);
  });

  it("slides a reply down past a whole stack of earlier replies", () => {
    const taken = [at(200), at(236), at(272)];
    const placed = settle(LINE, taken, "down");

    expect(placed.y).toBeGreaterThanOrEqual(272 + 30);
    expect(taken.some((rect) => rectsOverlap({ ...LINE, ...placed }, rect))).toBe(false);
  });

  it("goes the other way when the preferred side is walled off", () => {
    const wall = { x: 0, y: -2000, width: 600, height: 2230 };
    expect(settle(LINE, [wall], "up").y).toBeGreaterThan(230);
  });

  it("treats a note brushing against another as overlapping", () => {
    expect(settle(LINE, [at(200 + 30 + 2)], "up").y).not.toBe(200);
  });
});
