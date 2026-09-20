import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import type { Nature, Temper } from "../cat/types";
import { FLEE_RADIUS_PX, HEEL_PX, PERCH_ABOVE_PX } from "./constants";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  idOf,
  poseOf,
  rulingOf,
  runSteps,
  STAY,
} from "./testSupport";

const board = blankBoard("meadow");
const RESTING = 5;
const SETTLE_STEPS = 60;

const tempered = (nature: Nature, temper: Temper) => ({ ...rulingOf(nature), temper });

const raise = (
  name: string,
  nature: Nature,
  temper: Temper | null,
  at: { x: number; y: number },
) => {
  const sim = enter(board);
  sim.setWalkIntent(STAY);
  sim.addDrawing(drawingOf(name, blob(at.x, at.y, 50, 36)));
  runSteps(sim, SETTLE_STEPS);
  sim.applyRuling(idOf(name), temper === null ? rulingOf(nature) : tempered(nature, temper));
  return sim;
};

const whereIs = (sim: ReturnType<typeof raise>, name: string) => {
  const pose = poseOf(sim, name);
  if (pose === undefined) throw new Error(`${name} is gone`);
  return pose.position;
};

const gapAfter = (sim: ReturnType<typeof raise>, name: string, steps: number) => {
  runSteps(sim, steps);
  return whereIs(sim, name).x - feetOf(sim).x;
};

describe("a creature that follows Alice", () => {
  it("walks over to her and waits at her heel", () => {
    const name = "dog";
    const sim = raise(name, "walker", "follows", { x: 240, y: -RESTING });
    const gap = gapAfter(sim, name, 600);
    expect(Math.abs(gap)).toBeLessThan(HEEL_PX + 10);
    const later = gapAfter(sim, name, 300);
    expect(Math.abs(later)).toBeLessThan(HEEL_PX + 10);
    expect(Math.abs(later)).toBeGreaterThan(20);
  });

  it("hops its way to her", () => {
    const name = "puppy";
    const sim = raise(name, "hopper", "follows", { x: -260, y: -RESTING });
    expect(Math.abs(gapAfter(sim, name, 900))).toBeLessThan(HEEL_PX + 30);
  });

  it("flies to a perch above her head", () => {
    const name = "parrot";
    const sim = raise(name, "flier", "follows", { x: 280, y: -220 });
    runSteps(sim, 600);
    const perch = whereIs(sim, name);
    const head = sim.aliceBounds();
    expect(Math.abs(perch.x - (head.x + head.width / 2))).toBeLessThan(40);
    expect(head.y - perch.y).toBeGreaterThan(PERCH_ABOVE_PX - 40);
    expect(head.y - perch.y).toBeLessThan(PERCH_ABOVE_PX + 40);
  });
});

describe("a creature that flees Alice", () => {
  it("bolts away when she is near and stops caring once she is not", () => {
    const name = "mouse";
    const sim = raise(name, "walker", "flees", { x: 80, y: -RESTING });
    const gap = gapAfter(sim, name, 240);
    expect(gap).toBeGreaterThan(80);
    expect(gap).toBeLessThan(320);
  });

  it("hops off in the other direction", () => {
    const name = "hare";
    const sim = raise(name, "hopper", "flees", { x: -90, y: -RESTING });
    const gap = gapAfter(sim, name, 300);
    expect(gap).toBeLessThan(-FLEE_RADIUS_PX / 2);
  });
});

describe("a creature with no feelings about Alice", () => {
  it("roams as it always did", () => {
    const name = "tortoise";
    const sim = raise(name, "walker", null, { x: 200, y: -RESTING });
    const xs = Array.from({ length: 900 }, () => {
      sim.step();
      return whereIs(sim, name).x;
    });
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
  });
});
