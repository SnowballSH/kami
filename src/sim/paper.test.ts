import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { EARTH } from "../rules/types";
import { onPaper, wrappedAngle } from "./paper";
import {
  aliceOf,
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
import type { Simulation } from "./types";

const board = blankBoard("sketchbook");
const GROUND = board.spawn.y;
const ONE_SECOND = 60;

const drop = (sim: Simulation, name: string, x: number): void =>
  sim.addDrawing(drawingOf(name, blob(x, GROUND - 5, 20, 20)));

const xOf = (sim: Simulation, name: string): number => poseOf(sim, name)?.position.x ?? Number.NaN;

describe("the paper's turn", () => {
  it("wraps angles into a half turn either way", () => {
    expect(wrappedAngle(0)).toBe(0);
    expect(wrappedAngle(190)).toBe(-170);
    expect(wrappedAngle(-190)).toBe(170);
    expect(wrappedAngle(360)).toBe(0);
    expect(wrappedAngle(180)).toBe(180);
    expect(wrappedAngle(-180)).toBe(180);
  });

  it("sees the room's down along the paper's x once turned a quarter clockwise", () => {
    const down = onPaper({ x: 0, y: 1 }, 90);
    expect(down.x).toBeCloseTo(1, 9);
    expect(down.y).toBeCloseTo(0, 9);
    const flipped = onPaper({ x: 0, y: 1 }, 180);
    expect(flipped.y).toBeCloseTo(-1, 9);
    expect(onPaper({ x: 0, y: 1 }, 0)).toEqual({ x: 0, y: 1 });
  });

  it("lies upright until a tilt law sets an angle, and returns upright when it is repealed", () => {
    const sim = enter(board);
    expect(sim.paperAngle()).toBe(0);
    sim.setPhysics({ ...EARTH, tilt: 90 });
    expect(sim.paperAngle()).toBe(90);
    sim.setPhysics(EARTH);
    expect(sim.paperAngle()).toBe(0);
  });

  it("keeps turning under a spin law, slower in slow motion, and holds where it stopped", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, worldSpin: 30 });
    runSteps(sim, ONE_SECOND);
    expect(sim.paperAngle()).toBeCloseTo(30, 5);
    sim.setPhysics({ ...EARTH, worldSpin: 30, timeScale: 0.5 });
    runSteps(sim, ONE_SECOND);
    expect(sim.paperAngle()).toBeCloseTo(45, 5);
    sim.setPhysics(EARTH);
    runSteps(sim, ONE_SECOND);
    expect(sim.paperAngle()).toBeCloseTo(45, 5);
  });

  it("spins on from a tilt, and a new tilt starts the count over", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, tilt: 90, worldSpin: 60 });
    runSteps(sim, ONE_SECOND);
    expect(sim.paperAngle()).toBeCloseTo(150, 5);
    sim.setPhysics({ ...EARTH, tilt: -90, worldSpin: 60 });
    expect(sim.paperAngle()).toBeCloseTo(-90, 5);
    runSteps(sim, ONE_SECOND * 2);
    expect(sim.paperAngle()).toBeCloseTo(30, 5);
  });

  it("lets loose ink tumble toward the room's down while Alice keeps her feet on the paper", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, tilt: 90 });
    sim.setWalkIntent(STAY);
    drop(sim, "pebble", board.spawn.x + 200);
    runSteps(sim, 5);
    const start = xOf(sim, "pebble");
    runSteps(sim, ONE_SECOND);
    expect(xOf(sim, "pebble")).toBeGreaterThan(start + 100);
    expect(aliceOf(sim).grounded).toBe(true);
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x, 0);
    expect(feetOf(sim).y).toBeCloseTo(GROUND, 0);
  });

  it("leaves creatures of the paper, so a walker is not dragged off with the loose ink", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, tilt: 180 });
    drop(sim, "pebble", board.spawn.x - 200);
    sim.addDrawing(drawingOf("dog", blob(board.spawn.x + 200, GROUND - 5, 60, 40)));
    sim.applyRuling(idOf("dog"), rulingOf("walker"));
    runSteps(sim, ONE_SECOND);
    expect(poseOf(sim, "pebble")?.position.y ?? Number.NaN).toBeLessThan(GROUND - 200);
    expect(poseOf(sim, "dog")?.position.y ?? Number.NaN).toBeGreaterThan(GROUND - 60);
  });
});
