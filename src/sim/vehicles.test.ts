import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import type { Stroke } from "../core/geometry";
import { VEHICLE_SPEED, WALK_SPEED } from "./constants";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  idOf,
  LEFT,
  line,
  poseOf,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  STAY,
} from "./testSupport";
import type { Simulation } from "./types";

const board = blankBoard("garage");
const CAR = idOf("car");

const centreOf = (sim: Simulation): number => {
  const pose = poseOf(sim, "car");
  if (pose === undefined) throw new Error("the car is gone");
  return pose.position.x;
};

/** A flat-roofed cart on two wheels, parked just ahead of Alice, low enough to step onto. */
const cart = (): readonly Stroke[] => [
  line({ x: 35, y: -14 }, { x: 125, y: -14 }),
  blob(50, -2, 16, 12),
  blob(110, -2, 16, 12),
];

const parkCar = (): Simulation => {
  const sim = enter(board);
  sim.setWalkIntent(STAY);
  sim.addDrawing(drawingOf("car", ...cart()));
  sim.applyRuling(CAR, rulingOf("vehicle"));
  runSteps(sim, 60);
  return sim;
};

const climbAboard = (sim: Simulation): void => {
  sim.setWalkIntent(RIGHT);
  runUntil(sim, (_events, current) => current.snapshot().alice.grounded && feetOf(current).x > 60);
};

describe("ink ruled vehicle", () => {
  it("stays put with nobody aboard", () => {
    const sim = parkCar();
    const start = centreOf(sim);
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 5);
    sim.setWalkIntent(STAY);
    runSteps(sim, 60);
    expect(Math.abs(centreOf(sim) - start)).toBeLessThan(2);
  });

  it("carries Alice where she points, faster than she walks", () => {
    const sim = parkCar();
    climbAboard(sim);
    const start = centreOf(sim);
    const aliceStart = feetOf(sim).x;
    runSteps(sim, 40);
    const travelled = centreOf(sim) - start;
    expect(travelled).toBeGreaterThan(WALK_SPEED * 40);
    expect(travelled).toBeLessThanOrEqual(VEHICLE_SPEED * 40 + 1);
    expect(feetOf(sim).x - aliceStart).toBeCloseTo(travelled, -1);
  });

  it("brakes when she lets go and reverses when she points back", () => {
    const sim = parkCar();
    climbAboard(sim);
    runSteps(sim, 30);
    sim.setWalkIntent(STAY);
    runSteps(sim, 60);
    const parked = centreOf(sim);
    runSteps(sim, 10);
    expect(Math.abs(centreOf(sim) - parked)).toBeLessThan(1);
    sim.setWalkIntent(LEFT);
    runSteps(sim, 30);
    expect(centreOf(sim)).toBeLessThan(parked);
  });

  it("lets her jump off the back", () => {
    const sim = parkCar();
    climbAboard(sim);
    runSteps(sim, 20);
    sim.setWalkIntent(STAY);
    runSteps(sim, 60);
    const car = centreOf(sim);
    sim.setWalkIntent({ x: -1, y: -1 });
    runSteps(sim, 2);
    expect(sim.snapshot().alice.grounded).toBe(false);
    runUntil(sim, (_events, current) => current.snapshot().alice.grounded);
    runSteps(sim, 30);
    expect(Math.abs(centreOf(sim) - car)).toBeLessThan(2);
    expect(feetOf(sim).x).toBeLessThan(car - 45);
  });
});
