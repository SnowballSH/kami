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

  it("clears dense writing even when both directions need more than six line heights", () => {
    const taken = Array.from({ length: 19 }, (_, index) => at(200 + (index - 9) * 36));
    const placed = settle(LINE, taken, "up");
    expect(taken.some((rect) => rectsOverlap({ ...LINE, ...placed }, rect))).toBe(false);
  });

  it("keeps remarks below the toolbar and clears the intro instead of drifting above it", () => {
    const minY = 200;
    const intro = { ...LINE, y: 170, height: 100 };
    const placed = settle(at(100), [intro], "up", minY);
    expect(placed.y).toBeGreaterThanOrEqual(minY);
    expect(rectsOverlap({ ...LINE, ...placed }, intro)).toBe(false);
  });

  it("flips to the other side rather than leaving within", () => {
    const taken = [at(200)];
    const within = { x: 0, y: 100, width: 500, height: 136 };
    const placed = settle(LINE, taken, "down", Number.NEGATIVE_INFINITY, within);

    expect(placed.y).toBeLessThan(200);
    expect(placed.y + LINE.height).toBeLessThanOrEqual(within.y + within.height);
    expect(taken.some((rect) => rectsOverlap({ ...LINE, ...placed }, rect))).toBe(false);
  });

  it("returns origin when nothing fits within", () => {
    const taken = [at(200)];
    const within = { x: 0, y: 200, width: 500, height: 30 };

    expect(settle(LINE, taken, "down", Number.NEGATIVE_INFINITY, within)).toEqual({
      x: LINE.x,
      y: LINE.y,
    });
  });
});
