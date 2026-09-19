import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
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
  saw,
  standsOn,
  typesOf,
} from "./testSupport";

const board = blankBoard("sketchbook");
const PATCH_TOP = 0;
const RESTING = 5;
const INK_HALF_THICKNESS = 5;

describe("ink ruled solid", () => {
  it("returns to where it was drawn in mid-air, stays there, and carries her", () => {
    const sim = enter(board);
    const platformY = 200;
    sim.addDrawing(drawingOf("platform", line({ x: 300, y: platformY }, { x: 520, y: platformY })));
    const drawnAt = poseOf(sim, "platform");
    runSteps(sim, 40);
    expect(poseOf(sim, "platform")?.position.y).toBeGreaterThan(platformY + 50);

    sim.applyRuling(idOf("platform"), rulingOf("solid"));
    runSteps(sim, 120);
    expect(poseOf(sim, "platform")).toEqual(drawnAt);

    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(platformY - INK_HALF_THICKNESS, 400));
    expect(typesOf(events)).toEqual([]);
    expect(feetOf(sim).y).toBeCloseTo(platformY - INK_HALF_THICKNESS, 0);
    expect(poseOf(sim, "platform")).toEqual(drawnAt);
  });
});

describe("ink ruled hazard", () => {
  it("sends her back the moment she touches it", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("lava", blob(150, PATCH_TOP - RESTING, 60, 30)));
    sim.applyRuling(idOf("lava"), rulingOf("hazard"));
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("fell"));
    expect(typesOf(events)).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x, 0);
    expect(sim.snapshot().drawings).toHaveLength(1);
  });
});

describe("ink ruled spawn", () => {
  it("moves where she comes back to without moving her now", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("start", line({ x: -200, y: -30 }, { x: -200, y: -8 })));
    sim.applyRuling(idOf("start"), rulingOf("spawn"));
    sim.addDrawing(drawingOf("lava", blob(150, PATCH_TOP - RESTING, 60, 30)));
    sim.applyRuling(idOf("lava"), rulingOf("hazard"));
    runSteps(sim, 10);
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x, 0);

    sim.setWalkIntent(RIGHT);
    runUntil(sim, saw("fell"));
    expect(feetOf(sim).x).toBeCloseTo(-200, 0);

    sim.removeDrawing(idOf("start"));
    runUntil(sim, saw("fell"));
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x, 0);
  });
});

describe("ink ruled goal", () => {
  it("wins the board once, and she walks straight through it", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("flag", line({ x: 150, y: -80 }, { x: 150, y: -6 })));
    sim.applyRuling(idOf("flag"), rulingOf("goal"));
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 120);
    expect(typesOf(events)).toEqual(["goal-reached"]);
    expect(feetOf(sim).x).toBeGreaterThan(200);
    expect(poseOf(sim, "flag")?.angle).toBe(0);
  });
});
