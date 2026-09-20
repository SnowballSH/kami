import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import type { BoardDefinition } from "../board/types";
import type { Stroke } from "../core/geometry";
import { VEHICLE_SPEED, WALK_SPEED } from "./constants";
import {
  aliceOf,
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

const board: BoardDefinition = {
  ...blankBoard("garage"),
  solids: [{ rect: { x: -2000, y: 0, width: 4000, height: 36 }, material: "marker" }],
};
const flatBoard: BoardDefinition = {
  ...blankBoard("flat"),
  solids: [{ rect: { x: -2000, y: 0, width: 4000, height: 36 }, material: "marker" }],
};
const ledgeBoard: BoardDefinition = {
  ...blankBoard("ledge"),
  solids: [{ rect: { x: -320, y: 0, width: 480, height: 36 }, material: "marker" }],
};
const CAR = idOf("car");

const centreOf = (sim: Simulation): number => {
  const pose = poseOf(sim, "car");
  if (pose === undefined) throw new Error("the car is gone");
  return pose.position.x;
};

/** A flat-roofed cart parked just ahead of Alice, low enough to step onto. */
const cart = (): readonly Stroke[] => [
  line({ x: 35, y: -14 }, { x: 125, y: -14 }),
  line({ x: 125, y: -14 }, { x: 125, y: 4 }),
  line({ x: 125, y: 4 }, { x: 35, y: 4 }),
  line({ x: 35, y: 4 }, { x: 35, y: -14 }),
];
const stableCart = (): readonly Stroke[] => [line({ x: 35, y: -4 }, { x: 125, y: -4 })];

const parkCar = (definition = board, strokes = stableCart()): Simulation => {
  const sim = enter(definition);
  sim.setWalkIntent(STAY);
  sim.addDrawing(drawingOf("car", ...strokes));
  sim.applyRuling(CAR, rulingOf("vehicle"));
  runSteps(sim, 60);
  return sim;
};

const climbAboard = (sim: Simulation): void => {
  sim.setWalkIntent(RIGHT);
  runUntil(sim, (_events, current) => aliceOf(current).grounded && feetOf(current).x > 60);
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

  it("shows in her snapshot as her ride only while she is aboard", () => {
    const sim = parkCar();
    expect(aliceOf(sim).ride).toBeNull();
    climbAboard(sim);
    runSteps(sim, 2);
    expect(aliceOf(sim).ride).toEqual({ id: CAR, gait: "vehicle" });
    sim.setWalkIntent(STAY);
    runSteps(sim, 60);
    sim.setWalkIntent({ x: -1, y: -1 });
    runUntil(sim, (_events, current) => aliceOf(current).grounded && feetOf(current).x < 30);
    expect(aliceOf(sim).ride).toBeNull();
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
    expect(aliceOf(sim).grounded).toBe(false);
    runUntil(sim, (_events, current) => aliceOf(current).grounded);
    runSteps(sim, 30);
    expect(Math.abs(centreOf(sim) - car)).toBeLessThan(2);
    expect(feetOf(sim).x).toBeLessThan(car - 45);
  });

  it("keeps its angle damped while driven on flat ground", () => {
    const sim = parkCar(flatBoard);
    climbAboard(sim);
    runSteps(sim, 120);
    expect(Math.abs(poseOf(sim, "car")?.angle ?? Number.POSITIVE_INFINITY)).toBeLessThan(0.05);
  });

  it("stays level while Alice boards and stands on its rear", () => {
    const sim = parkCar(flatBoard, cart());
    climbAboard(sim);
    sim.setWalkIntent(STAY);
    runSteps(sim, 60);
    expect(Math.abs(poseOf(sim, "car")?.angle ?? Number.POSITIVE_INFINITY)).toBeLessThan(0.08);
    expect(aliceOf(sim).ride).toEqual({ id: CAR, gait: "vehicle" });
  });

  it("tips and tumbles after its footing ends", () => {
    const sim = parkCar(ledgeBoard, cart());
    climbAboard(sim);
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 240);
    expect(Math.abs(poseOf(sim, "car")?.angle ?? 0)).toBeGreaterThan(0.3);
  });
});
