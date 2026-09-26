import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { wonderland } from "../board/boards/wonderland";
import type { BoardDefinition } from "../board/types";
import { EARTH } from "../rules/types";
import {
  aliceOf,
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
  UP,
} from "./testSupport";
import { ALICE_BASE, ALICE_HERSELF, type AliceIndex } from "./types";

const GROUND_TOP = 560;
const PLATEAU_TOP = 340;
const RESTING = 5;
const blank = blankBoard("sketchbook");

const onThePlateau: BoardDefinition = { ...wonderland, spawn: { x: 1760, y: PLATEAU_TOP } };

describe("a freshly loaded board", () => {
  it("raises an incarnated body out of an overlapping floor", () => {
    const sim = enter(blank);
    const heart = { x: 0, y: -20 };
    sim.disembody();
    sim.addDrawing(drawingOf("body", blob(heart.x, 30, 50, 100)));
    expect(sim.incarnate(idOf("body"), "alice")).toBe(true);
    expect(feetOf(sim).y).toBeCloseTo(blank.solids[0]?.rect.y ?? 0, 0);
  });

  it("shuffles a torso even without leg strokes", () => {
    const sim = enter(blank);
    const heart = { x: 0, y: -20 };
    sim.disembody();
    sim.addDrawing(drawingOf("body", blob(heart.x, 0, 40, 40)));
    expect(sim.incarnate(idOf("body"), "alice")).toBe(true);
    const parked = feetOf(sim).x;
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 60);
    expect(feetOf(sim).x).toBeGreaterThan(parked + 5);
  });

  it("stands Alice on her spawn at normal size", () => {
    const sim = enter(wonderland);
    runSteps(sim, 30);
    const { drawings, keyTaken, doorOpen } = sim.snapshot();
    const alice = aliceOf(sim);
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
    expect(aliceOf(sim).grounded).toBe(true);
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
    expect(aliceOf(sim).grounded).toBe(true);
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

describe("jumping", () => {
  const apexOf = (sim: ReturnType<typeof enter>, steps: number): number => {
    let apex = feetOf(sim).y;
    for (let step = 0; step < steps; step++) {
      sim.step();
      apex = Math.min(apex, feetOf(sim).y);
    }
    return apex;
  };

  it("springs off the ground on up and comes back down on her feet", () => {
    const sim = enter(wonderland);
    runSteps(sim, RESTING);
    sim.setWalkIntent(UP);
    sim.step();
    expect(aliceOf(sim).grounded).toBe(false);

    const apex = apexOf(sim, 60);
    expect(GROUND_TOP - apex).toBeGreaterThan(ALICE_BASE.height);
    expect(GROUND_TOP - apex).toBeLessThan(2 * ALICE_BASE.height);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
    expect(aliceOf(sim).grounded).toBe(true);
  });

  it("hops once per press, however long up is held", () => {
    const sim = enter(wonderland);
    runSteps(sim, RESTING);
    sim.setWalkIntent(UP);
    const held = apexOf(sim, 120);

    const tapped = enter(wonderland);
    runSteps(tapped, RESTING);
    tapped.setWalkIntent(UP);
    tapped.step();
    tapped.setWalkIntent(STAY);
    expect(apexOf(tapped, 120)).toBeCloseTo(held, 0);
  });

  it("carries her walking speed across the jump", () => {
    const sim = enter(wonderland);
    runSteps(sim, RESTING);
    sim.setWalkIntent({ x: 1, y: -1 });
    sim.step();
    const takeOffX = feetOf(sim).x;
    runUntil(sim, (_, s) => aliceOf(s).grounded, 120);
    expect(feetOf(sim).x - takeOffX).toBeGreaterThan(ALICE_BASE.width * 2);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
  });

  it("climbs rather than jumps when up is pressed on a ladder", () => {
    const sim = enter(wonderland);
    const ladderX = wonderland.spawn.x;
    sim.addDrawing(
      drawingOf("ladder", line({ x: ladderX, y: GROUND_TOP }, { x: ladderX, y: GROUND_TOP - 200 })),
    );
    sim.applyRuling(idOf("ladder"), rulingOf("climbable"));
    runSteps(sim, RESTING);
    sim.setWalkIntent(UP);
    runSteps(sim, 40);
    expect(aliceOf(sim).climbing).toBe(true);
    expect(feetOf(sim).y).toBeLessThan(GROUND_TOP - 40);
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
    expect(aliceOf(sim).size).toBe("normal");
    expect(sim.snapshot().drawings).toHaveLength(1);
  });

  it("checks the law-scaled growth height under a ceiling", () => {
    const sim = enter({
      ...onThePlateau,
      solids: [
        ...wonderland.solids,
        { rect: { x: 1700, y: 180, width: 300, height: 30 }, material: "marker" },
      ],
    });
    sim.setPhysics({ ...EARTH, aliceSize: 2 });
    runSteps(sim, 60);
    expect(aliceOf(sim).height).toBeCloseTo(120);
    sim.addDrawing(drawingOf("cake", blob(1830, PLATEAU_TOP - RESTING, 60, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 60);
    expect(happeningsOf(events)).toContain("grow-blocked");
    expect(aliceOf(sim).size).toBe("normal");
    expect(sim.snapshot().drawings).toHaveLength(1);
  });

  it("checks the full growth width beside a wall", () => {
    const sim = enter({
      ...blank,
      spawn: { x: 100, y: 400 },
      solids: [
        { rect: { x: 0, y: 400, width: 1000, height: 40 }, material: "marker" },
        { rect: { x: 120, y: 0, width: 40, height: 400 }, material: "marker" },
      ],
    });
    runSteps(sim, 30);
    sim.addDrawing(drawingOf("cake", blob(80, 395, 16, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    const events = runSteps(sim, 60);
    expect(happeningsOf(events)).toContain("grow-blocked");
    expect(aliceOf(sim).size).toBe("normal");
  });
  it("measures a drawn body's growth from her own height", () => {
    const sim = enter({
      ...blank,
      solids: [
        ...blank.solids,
        { rect: { x: -320, y: -210, width: 640, height: 40 }, material: "marker" },
      ],
    });
    sim.disembody();
    sim.addDrawing(drawingOf("body", blob(0, 0, 60, 150)));
    expect(sim.incarnate(idOf("body"), "giant")).toBe(true);
    const height = sim.aliceBounds().height;
    expect(height).toBeCloseTo(150, 0);
    sim.addDrawing(drawingOf("cake", blob(50, -RESTING, 16, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("grow-blocked"), 300);
    expect(happeningsOf(events)).toContain("grow-blocked");
    runSteps(sim, 60);
    expect(sim.aliceBounds().height).toBeCloseTo(height, 0);
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
    const { drawings, keyTaken, doorOpen } = sim.snapshot();
    const alice = aliceOf(sim);
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

describe("the key", () => {
  const takeTheKey = (sim: ReturnType<typeof enter>, who: AliceIndex = ALICE_HERSELF): void => {
    sim.addDrawing(drawingOf("cake", blob(1830, PLATEAU_TOP - RESTING, 30, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT, who);
    expect(happeningsOf(runUntil(sim, saw("key-taken")))).toContain("key-taken");
    sim.setWalkIntent(STAY, who);
  };

  it("stays in hand when she leaves her body and is drawn a new one", () => {
    const sim = enter(onThePlateau);
    takeTheKey(sim);
    sim.disembody();
    const seat = sim.snapshot().soul?.at ?? { x: Number.NaN, y: Number.NaN };
    sim.addDrawing(drawingOf("body", blob(seat.x, seat.y + 15, 20, 30)));
    expect(sim.incarnate(idOf("body"), "alice")).toBe(true);
    expect(aliceOf(sim).hasKey).toBe(true);
    sim.setWalkIntent(RIGHT);
    expect(happeningsOf(runUntil(sim, saw("door-opened")))).toContain("door-opened");
    expect(sim.snapshot().doorOpen).toBe(true);
  });

  it("passes to Alice when the twin holding it is dismissed", () => {
    const sim = enter(onThePlateau);
    sim.setPhysics({ ...EARTH, clones: 1 });
    takeTheKey(sim, 1);
    expect(sim.alices()[1]?.hasKey).toBe(true);
    sim.setPhysics(EARTH);
    expect(aliceOf(sim).hasKey).toBe(true);
    sim.setPhysics({ ...EARTH, aliceSize: 0.5 });
    sim.setWalkIntent(RIGHT);
    expect(happeningsOf(runUntil(sim, saw("door-opened")))).toContain("door-opened");
    expect(sim.snapshot().doorOpen).toBe(true);
  });
});
