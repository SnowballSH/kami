import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { FLY_ROAM_PX } from "./constants";
import { freshMind } from "./creatures";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  idOf,
  line,
  poseOf,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  STAY,
} from "./testSupport";

const board = blankBoard("meadow");
const PATCH_TOP = 0;
const PATCH_EDGE = 320;
const RESTING = 5;
const SETTLE_STEPS = 60;

const settle = (name: string, centreX: number, bottom: number) => {
  const sim = enter(board);
  sim.setWalkIntent(STAY);
  sim.addDrawing(drawingOf(name, blob(centreX, bottom, 50, 36)));
  runSteps(sim, SETTLE_STEPS);
  return sim;
};

const centreOf = (sim: ReturnType<typeof settle>, name: string) => {
  const pose = poseOf(sim, name);
  if (pose === undefined) throw new Error(`${name} is gone`);
  return pose;
};

const trace = (sim: ReturnType<typeof settle>, name: string, steps: number) =>
  Array.from({ length: steps }, () => {
    sim.step();
    return centreOf(sim, name);
  });

describe("ink ruled walker", () => {
  it("paces its ground, turns at the edge and never tips over", () => {
    const name = "tortoise";
    const sim = settle(name, 200, PATCH_TOP - RESTING);
    const start = centreOf(sim, name).position;
    sim.applyRuling(idOf(name), rulingOf("walker"));

    const path = trace(sim, name, 900);
    const xs = path.map(({ position }) => position.x);
    const { facing } = freshMind(idOf(name));
    expect(Math.sign((xs[60] ?? start.x) - start.x)).toBe(facing);
    expect(Math.min(...xs)).toBeGreaterThan(-PATCH_EDGE);
    expect(Math.max(...xs)).toBeLessThan(PATCH_EDGE);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
    for (const { position, angle } of path) {
      expect(Math.abs(angle)).toBeLessThan(0.05);
      expect(position.y).toBeCloseTo(start.y, -1);
    }
  });

  it("turns back rather than shoving Alice", () => {
    const name = "hedgehog";
    const { facing } = freshMind(idOf(name));
    const sim = settle(name, -facing * 120, PATCH_TOP - RESTING);
    sim.applyRuling(idOf(name), rulingOf("walker"));

    const xs = trace(sim, name, 600).map(({ position }) => position.x);
    const alice = feetOf(sim).x;
    const gap = xs.map((x) => (x - alice) * -facing);
    expect(Math.min(...gap)).toBeGreaterThan(20);
    expect(Math.abs(feetOf(sim).x)).toBeLessThan(5);
  });
});

describe("riding a creature", () => {
  it("carries Alice along once she stands on it", () => {
    const name = "turtle";
    const sim = enter(board);
    sim.addDrawing(
      drawingOf(name, line({ x: 30, y: PATCH_TOP - 4 }, { x: 250, y: PATCH_TOP - 4 })),
    );
    runSteps(sim, SETTLE_STEPS);
    sim.setWalkIntent(RIGHT);
    runUntil(sim, (_, current) => current.aliceBounds().x > 120);
    sim.setWalkIntent(STAY);
    sim.applyRuling(idOf(name), rulingOf("walker"));
    runSteps(sim, 30);

    const before = { alice: feetOf(sim).x, turtle: centreOf(sim, name).position.x };
    runSteps(sim, 90);
    const after = { alice: feetOf(sim).x, turtle: centreOf(sim, name).position.x };
    const carried = after.turtle - before.turtle;
    expect(Math.abs(carried)).toBeGreaterThan(60);
    expect(after.alice - before.alice).toBeCloseTo(carried, -1);
  });
});

describe("ink ruled hopper", () => {
  it("leaps on a beat and stays on its patch", () => {
    const name = "white rabbit";
    const sim = settle(name, 100, PATCH_TOP - RESTING);
    sim.applyRuling(idOf(name), rulingOf("hopper"));

    const path = trace(sim, name, 900);
    const ys = path.map(({ position }) => position.y);
    const xs = path.map(({ position }) => position.x);
    const rest = Math.max(...ys);
    expect(rest - Math.min(...ys)).toBeGreaterThan(25);
    expect(ys.filter((y) => Math.abs(y - rest) < 2).length).toBeGreaterThan(200);
    expect(Math.min(...xs)).toBeGreaterThan(-PATCH_EDGE);
    expect(Math.max(...xs)).toBeLessThan(PATCH_EDGE);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(80);
  });
});

describe("ink ruled flier", () => {
  it("keeps its height and roams only so far from where it was drawn", () => {
    const name = "bluebird";
    const sim = enter(board);
    sim.addDrawing(drawingOf(name, blob(0, -200, 50, 36)));
    sim.applyRuling(idOf(name), rulingOf("flier"));
    const start = centreOf(sim, name).position;

    const path = trace(sim, name, 1500);
    const xs = path.map(({ position }) => position.x);
    for (const { position } of path) expect(Math.abs(position.y - start.y)).toBeLessThan(40);
    expect(Math.max(...xs.map((x) => Math.abs(x - start.x)))).toBeLessThan(FLY_ROAM_PX + 40);
    expect(Math.max(...xs.map((x) => Math.abs(x - start.x)))).toBeGreaterThan(FLY_ROAM_PX - 40);
    expect(Math.min(...xs) < start.x && Math.max(...xs) > start.x).toBe(true);
  });
});
