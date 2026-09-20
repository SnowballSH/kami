import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { EARTH, type WorldPhysics } from "../rules/types";
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
  saw,
} from "./testSupport";
import type { Simulation } from "./types";

const board = blankBoard("sketchbook");
const MOON: WorldPhysics = { ...EARTH, gravity: { x: 0, y: 0.165 } };
const WEIGHTLESS: WorldPhysics = { ...EARTH, gravity: { x: 0, y: 0 } };

const dropPlank = (sim: Simulation): void =>
  sim.addDrawing(drawingOf("plank", line({ x: 100, y: -300 }, { x: 200, y: -300 })));

const bounceHeightUnder = (physics: WorldPhysics): number => {
  const sim = enter(board);
  sim.setPhysics(physics);
  sim.addDrawing(drawingOf("mushroom", blob(120, -5, 60, 40)));
  sim.applyRuling(idOf("mushroom"), rulingOf("bouncy"));
  sim.setWalkIntent(RIGHT);
  runUntil(sim, saw("bounced"));
  sim.setWalkIntent(STAY);
  const launchedFrom = feetOf(sim).y;
  const heights = Array.from({ length: 400 }, () => {
    sim.step();
    return launchedFrom - feetOf(sim).y;
  });
  return Math.max(...heights);
};

describe("world physics", () => {
  it("makes the same bounce go much higher on the Moon", () => {
    const onEarth = bounceHeightUnder(EARTH);
    const onTheMoon = bounceHeightUnder(MOON);
    expect(onEarth).toBeGreaterThan(220);
    expect(onTheMoon).toBeGreaterThan(onEarth * 1.8);
  });

  it("leaves a dropped stroke hanging when gravity is off", () => {
    const sim = enter(board);
    sim.setPhysics(WEIGHTLESS);
    dropPlank(sim);
    runSteps(sim, 120);
    expect(poseOf(sim, "plank")?.position.y).toBeCloseTo(-300, 3);
  });

  it("applies to ink that was already there", () => {
    const sim = enter(board);
    dropPlank(sim);
    runSteps(sim, 20);
    sim.setPhysics({ ...EARTH, gravity: { x: 0, y: -1 } });
    runSteps(sim, 200);
    expect(poseOf(sim, "plank")?.position.y).toBeLessThan(-300);
  });

  it("keeps a settled bouncy drawing sound when a law is written after it", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("mushroom", blob(120, -5, 60, 40)));
    sim.applyRuling(idOf("mushroom"), rulingOf("bouncy"));
    runSteps(sim, 5);
    sim.setPhysics(MOON);
    sim.setWalkIntent(RIGHT);
    runUntil(sim, saw("bounced"));
    runSteps(sim, 60);
    expect(Number.isFinite(feetOf(sim).y)).toBe(true);
    expect(feetOf(sim).y).toBeLessThan(-40);
  });

  it("blows a free stroke sideways", () => {
    const sim = enter(board);
    sim.setPhysics({ ...WEIGHTLESS, wind: { x: 0.5, y: 0 } });
    dropPlank(sim);
    runSteps(sim, 60);
    const pose = poseOf(sim, "plank");
    expect(pose?.position.x).toBeGreaterThan((pose?.origin.x ?? 0) + 100);
    expect(pose?.position.y).toBeCloseTo(-300, 3);
  });

  it("survives loading another board", () => {
    const sim = enter(board);
    sim.setPhysics(WEIGHTLESS);
    sim.loadBoard(blankBoard("another"));
    dropPlank(sim);
    runSteps(sim, 120);
    expect(poseOf(sim, "plank")?.position.y).toBeCloseTo(-300, 3);
  });

  it("multiplies its time scale with bullet-time, and stays stable when time runs fast", () => {
    const distanceWalked = (worldScale: number, bulletTime: number): number => {
      const sim = enter(board);
      sim.setPhysics({ ...EARTH, timeScale: worldScale });
      sim.setTimeScale(bulletTime);
      sim.setWalkIntent(RIGHT);
      runSteps(sim, 40);
      return feetOf(sim).x - board.spawn.x;
    };
    const realTime = distanceWalked(1, 1);
    expect(distanceWalked(0.5, 0.5) / realTime).toBeCloseTo(0.25, 1);
    expect(distanceWalked(3, 1) / realTime).toBeCloseTo(3, 1);
  });

  it("lets her slide on when the world has no friction", () => {
    const slideAfterStopping = (physics: WorldPhysics): number => {
      const sim = enter(board);
      sim.setPhysics(physics);
      sim.setWalkIntent(RIGHT);
      runSteps(sim, 80);
      const stoppedAt = feetOf(sim).x;
      sim.setWalkIntent(STAY);
      runSteps(sim, 30);
      return feetOf(sim).x - stoppedAt;
    };
    expect(slideAfterStopping(EARTH)).toBeCloseTo(0, 0);
    expect(slideAfterStopping({ ...EARTH, friction: 0 })).toBeGreaterThan(10);
  });
});
