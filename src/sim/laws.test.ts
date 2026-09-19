import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { EARTH, type WorldPhysics } from "../rules/types";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  happeningsOf,
  idOf,
  poseOf,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  UP,
} from "./testSupport";
import { ALICE_BASE, type Simulation } from "./types";

const board = blankBoard("sketchbook");
const GROUND = board.spawn.y;

const distanceWalked = (physics: WorldPhysics): number => {
  const sim = enter(board);
  sim.setPhysics(physics);
  sim.setWalkIntent(RIGHT);
  runSteps(sim, 60);
  return feetOf(sim).x - board.spawn.x;
};

const dropPebble = (sim: Simulation, x: number): void =>
  sim.addDrawing(drawingOf("pebble", blob(x, GROUND - 5, 20, 20)));

describe("laws about Alice", () => {
  it("lets her rise straight up off the ground while flying, and drops her when the law goes", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, flight: 1 });
    sim.setWalkIntent(UP);
    runSteps(sim, 60);
    expect(feetOf(sim).y).toBeLessThan(GROUND - 100);
    expect(sim.snapshot().alice.grounded).toBe(false);

    sim.setWalkIntent({ x: 0, y: 0 });
    runSteps(sim, 60);
    expect(feetOf(sim).y).toBeLessThan(GROUND - 100);

    sim.setPhysics(EARTH);
    runSteps(sim, 120);
    expect(feetOf(sim).y).toBeCloseTo(GROUND, 0);
    expect(sim.snapshot().alice.grounded).toBe(true);
  });

  it("walks her twice as far in the same time when the pace law says so", () => {
    expect(distanceWalked({ ...EARTH, walkSpeed: 2 }) / distanceWalked(EARTH)).toBeCloseTo(2, 0);
  });

  it("scales her body by the size law and back again", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, aliceSize: 2 });
    runSteps(sim, 60);
    expect(sim.snapshot().alice.height).toBeCloseTo(ALICE_BASE.height * 2, 0);
    sim.setPhysics(EARTH);
    runSteps(sim, 60);
    expect(sim.snapshot().alice.height).toBeCloseTo(ALICE_BASE.height, 0);
  });

  it("draws loose drawings toward her when she attracts, and pushes them off when she repels", () => {
    const gapAfter = (attraction: number): number => {
      const sim = enter(board);
      sim.setPhysics({ ...EARTH, attraction, friction: 0 });
      dropPebble(sim, board.spawn.x + 120);
      runSteps(sim, 90);
      return (poseOf(sim, "pebble")?.position.x ?? Number.NaN) - feetOf(sim).x;
    };
    expect(gapAfter(0)).toBeCloseTo(120, 0);
    expect(gapAfter(2)).toBeLessThan(60);
    expect(gapAfter(-2)).toBeGreaterThan(150);
  });

  it("walks her twins in step with her, and dismisses them when the law is erased", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, clones: 2 });
    runSteps(sim, 30);
    const before = sim.snapshot().twins.map((twin) => twin.center.x);
    expect(before).toHaveLength(2);

    sim.setWalkIntent(RIGHT);
    runSteps(sim, 60);
    const after = sim.snapshot().twins;
    for (const [index, twin] of after.entries()) {
      expect(twin.center.x - (before[index] ?? 0)).toBeGreaterThan(50);
      expect(twin.grounded).toBe(true);
    }

    sim.setPhysics(EARTH);
    expect(sim.snapshot().twins).toEqual([]);
  });
});

describe("laws about the world", () => {
  it("melts ice and burns off clouds in the heat, but leaves plain ink alone", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("ice", blob(-200, GROUND - 5, 40, 20)));
    sim.addDrawing(drawingOf("cloud", blob(200, GROUND - 5, 40, 20)));
    sim.addDrawing(drawingOf("rock", blob(0, GROUND - 5, 40, 20)));
    sim.applyRuling(idOf("ice"), rulingOf("slippery"));
    sim.applyRuling(idOf("cloud"), rulingOf("floaty"));
    runSteps(sim, 30);

    sim.setPhysics({ ...EARTH, temperature: 100 });
    const events = runUntil(
      sim,
      (all) => all.filter((event) => event.type === "perished").length === 2,
    );
    expect(happeningsOf(events).filter((type) => type === "perished")).toHaveLength(2);
    expect(sim.snapshot().drawings.map(({ id }) => id)).toEqual([idOf("rock")]);
  });

  it("keeps ice at room temperature", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("ice", blob(0, GROUND - 5, 40, 20)));
    sim.applyRuling(idOf("ice"), rulingOf("slippery"));
    expect(happeningsOf(runSteps(sim, 600))).not.toContain("perished");
  });

  it("pulls loose drawings toward a black hole", () => {
    const sim = enter(board);
    sim.setPhysics({ ...EARTH, friction: 0 });
    sim.addDrawing(drawingOf("hole", blob(-200, GROUND - 5, 60, 60)));
    sim.applyRuling(idOf("hole"), rulingOf("attractor"));
    dropPebble(sim, 100);
    runSteps(sim, 30);
    const start = poseOf(sim, "pebble")?.position.x ?? Number.NaN;
    runSteps(sim, 120);
    expect(poseOf(sim, "pebble")?.position.x ?? Number.NaN).toBeLessThan(start - 40);
  });
});
