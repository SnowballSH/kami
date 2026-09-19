import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { wonderland } from "../board/boards/wonderland";
import type { BoardDefinition } from "../board/types";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  happeningsOf,
  idOf,
  LEFT,
  line,
  poseOf,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  STAY,
  saw,
} from "./testSupport";
import { ALICE_BASE } from "./types";

const GROUND_TOP = 560;
const PLATEAU_TOP = 340;
const RESTING = 5;
const blank = blankBoard("sketchbook");

const onThePlateau: BoardDefinition = { ...wonderland, spawn: { x: 1760, y: PLATEAU_TOP } };

describe("a freshly loaded board", () => {
  it("stands Alice on her spawn at normal size", () => {
    const sim = enter(wonderland);
    runSteps(sim, 30);
    const { alice, drawings, keyTaken, doorOpen } = sim.snapshot();
    expect(feetOf(sim).x).toBeCloseTo(wonderland.spawn.x, 0);
    expect(feetOf(sim).y).toBeCloseTo(wonderland.spawn.y, 0);
    expect(alice).toMatchObject({ size: "normal", grounded: true, climbing: false, hasKey: false });
    expect(alice.width).toBeCloseTo(ALICE_BASE.width, 0);
    expect(alice.height).toBeCloseTo(ALICE_BASE.height, 0);
    expect({ drawings, keyTaken, doorOpen }).toEqual({
      drawings: [],
      keyTaken: false,
      doorOpen: false,
    });
  });

  it("stands her on the patch of a blank board, and lets her fall off its edge", () => {
    const sim = enter(blank);
    expect(runSteps(sim, 30)).toEqual([]);
    expect(sim.snapshot().alice.grounded).toBe(true);
    expect(feetOf(sim).x).toBeCloseTo(blank.spawn.x, 0);
    expect(feetOf(sim).y).toBeCloseTo(blank.spawn.y, 0);

    sim.setWalkIntent(RIGHT);
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(blank.spawn.x, 0);
  });

  it("has no edge to walk into", () => {
    const sim = enter(wonderland);
    sim.setWalkIntent(LEFT);
    runSteps(sim, 300);
    expect(feetOf(sim).x).toBeLessThan(-400);
    expect(sim.snapshot().alice.grounded).toBe(true);
  });

  it("crawls in bullet-time", () => {
    const distanceWalked = (scale: number): number => {
      const sim = enter(wonderland);
      sim.setTimeScale(scale);
      sim.setWalkIntent(RIGHT);
      runSteps(sim, 100);
      return feetOf(sim).x - wonderland.spawn.x;
    };
    expect(distanceWalked(0.15) / distanceWalked(1)).toBeCloseTo(0.15, 1);
  });
});

describe("anchoring", () => {
  it("lets unanchored ink fall to the ground", () => {
    const sim = enter(wonderland);
    sim.addDrawing(drawingOf("plank", line({ x: 800, y: 300 }, { x: 900, y: 300 })));
    const drawnAt = poseOf(sim, "plank");
    runSteps(sim, 240);
    const restingAt = poseOf(sim, "plank");
    expect(drawnAt?.position).toEqual(drawnAt?.origin);
    expect(restingAt?.origin).toEqual(drawnAt?.origin);
    expect(restingAt?.position.y).toBeGreaterThan(GROUND_TOP - 40);
    expect(restingAt?.position.y).toBeLessThan(GROUND_TOP);
  });

  it("holds ink that leans on marker but not ink that leans on glass", () => {
    const sim = enter(wonderland);
    sim.addDrawing(drawingOf("on-marker", line({ x: 2494, y: 100 }, { x: 2494, y: 180 })));
    sim.addDrawing(drawingOf("on-glass", line({ x: 1844, y: 120 }, { x: 1844, y: 200 })));
    runSteps(sim, 120);
    expect(poseOf(sim, "on-marker")?.position.y).toBeCloseTo(140, 5);
    expect(poseOf(sim, "on-glass")?.position.y).toBeGreaterThan(250);
  });

  it("forgets a removed drawing, body and all", () => {
    const sim = enter(wonderland);
    sim.addDrawing(drawingOf("bridge", line({ x: 370, y: 556 }, { x: 610, y: 556 })));
    sim.removeDrawing(idOf("bridge"));
    expect(sim.snapshot().drawings).toEqual([]);
    sim.setWalkIntent(RIGHT);
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
  });
});

describe("natures", () => {
  it("floats a balloon up even though it was anchored, with no ceiling to stop it", () => {
    const sim = enter(wonderland);
    sim.addDrawing(drawingOf("balloon", blob(900, GROUND_TOP - RESTING, 60, 40)));
    runSteps(sim, 30);
    expect(poseOf(sim, "balloon")?.position.y).toBeCloseTo(GROUND_TOP - 25, 0);
    sim.applyRuling(idOf("balloon"), rulingOf("floaty"));
    runSteps(sim, 700);
    expect(poseOf(sim, "balloon")?.position.y).toBeLessThan(-100);
  });

  it("freezes sticky ink where it lands", () => {
    const tiltAfterLanding = (nature: "ink" | "sticky"): number => {
      const sim = enter(wonderland);
      sim.addDrawing(drawingOf("stick", line({ x: 900, y: 300 }, { x: 930, y: 420 })));
      sim.applyRuling(idOf("stick"), rulingOf(nature));
      runSteps(sim, 400);
      return Math.abs(poseOf(sim, "stick")?.angle ?? 0);
    };
    expect(tiltAfterLanding("sticky")).toBeLessThan(0.2);
    expect(tiltAfterLanding("ink")).toBeGreaterThan(1);
  });

  it("sticks a sticky shelf to marker but lets it slip off glass", () => {
    const sim = enter(wonderland);
    sim.addDrawing(drawingOf("on-marker", line({ x: 2460, y: 100 }, { x: 2494, y: 100 })));
    sim.addDrawing(drawingOf("on-glass", line({ x: 1810, y: 190 }, { x: 1844, y: 190 })));
    sim.applyRuling(idOf("on-marker"), rulingOf("sticky"));
    sim.applyRuling(idOf("on-glass"), rulingOf("sticky"));
    runSteps(sim, 240);
    expect(poseOf(sim, "on-marker")?.position.y).toBeCloseTo(100, 5);
    expect(poseOf(sim, "on-glass")?.position.y).toBeGreaterThan(300);
  });

  it("refuses to grow her under a low ceiling, once per touch, and leaves the cake", () => {
    const lowCeiling: BoardDefinition = {
      ...onThePlateau,
      solids: [
        ...wonderland.solids,
        { rect: { x: 1700, y: 200, width: 300, height: 60 }, material: "marker" },
      ],
    };
    const sim = enter(lowCeiling);
    sim.addDrawing(drawingOf("cake", blob(1830, PLATEAU_TOP - RESTING, 60, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 300);
    expect(happeningsOf(events)).toEqual(["grow-blocked"]);
    expect(sim.snapshot().alice.size).toBe("normal");
    expect(sim.snapshot().drawings).toHaveLength(1);
  });
});

describe("loadBoard", () => {
  it("resets key, door, size, drawings and pending events", () => {
    const sim = enter(onThePlateau);
    sim.addDrawing(drawingOf("cake", blob(1830, PLATEAU_TOP - RESTING, 30, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    runUntil(sim, saw("key-taken"));
    sim.addDrawing(drawingOf("scribble", line({ x: 2200, y: 100 }, { x: 2260, y: 100 })));
    expect(sim.snapshot()).toMatchObject({ keyTaken: true, alice: { size: "big", hasKey: true } });

    sim.setWalkIntent(STAY);
    sim.loadBoard(onThePlateau);
    const events = runSteps(sim, 60);
    const { alice, drawings, keyTaken, doorOpen } = sim.snapshot();
    expect(happeningsOf(events)).toEqual([]);
    expect({ drawings, keyTaken, doorOpen }).toEqual({
      drawings: [],
      keyTaken: false,
      doorOpen: false,
    });
    expect(alice).toMatchObject({ size: "normal", hasKey: false });
    expect(feetOf(sim).x).toBeCloseTo(onThePlateau.spawn.x, 0);
    expect(alice.height).toBeCloseTo(ALICE_BASE.height, 0);
  });
});
