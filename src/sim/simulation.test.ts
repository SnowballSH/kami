import { describe, expect, it } from "vitest";
import { hallOfDoors } from "../game/levels/hallOfDoors";
import { riverbank } from "../game/levels/riverbank";
import { shelves } from "../game/levels/shelves";
import type { LevelDefinition } from "../game/types";
import { createSimulation } from "./index";
import {
  blob,
  drawingOf,
  idOf,
  line,
  rulingOf,
  runSteps,
  runUntil,
  saw,
  typesOf,
} from "./testSupport";
import { ALICE_BASE, type Simulation } from "./types";

const RIGHT = { x: 1, y: 0 } as const;
const LEFT = { x: -1, y: 0 } as const;

const enter = (level: LevelDefinition): Simulation => {
  const sim = createSimulation();
  sim.loadLevel(level);
  return sim;
};

const poseOf = (sim: Simulation, id: string) =>
  sim.snapshot().drawings.find((drawing) => drawing.id === id)?.pose;

describe("a freshly loaded room", () => {
  it("stands Alice on her spawn at normal size", () => {
    const sim = enter(shelves);
    runSteps(sim, 30);
    const { alice, drawings, keyTaken, doorOpen } = sim.snapshot();
    expect(alice.center.x).toBeCloseTo(shelves.spawn.x, 0);
    expect(alice.center.y + alice.height / 2).toBeCloseTo(shelves.spawn.y, 0);
    expect(alice).toMatchObject({ size: "normal", grounded: true, climbing: false, hasKey: false });
    expect(alice.width).toBeCloseTo(ALICE_BASE.width, 0);
    expect(alice.height).toBeCloseTo(ALICE_BASE.height, 0);
    expect({ drawings, keyTaken, doorOpen }).toEqual({
      drawings: [],
      keyTaken: false,
      doorOpen: false,
    });
  });

  it("keeps her on the page", () => {
    const sim = enter(shelves);
    sim.setWalkIntent(LEFT);
    runSteps(sim, 300);
    expect(sim.aliceBounds().x).toBeGreaterThanOrEqual(-1);
  });

  it("crawls in bullet-time", () => {
    const distanceWalked = (scale: number): number => {
      const sim = enter(shelves);
      sim.setTimeScale(scale);
      sim.setWalkIntent(RIGHT);
      runSteps(sim, 100);
      return sim.snapshot().alice.center.x - shelves.spawn.x;
    };
    expect(distanceWalked(0.15) / distanceWalked(1)).toBeCloseTo(0.15, 1);
  });
});

describe("anchoring", () => {
  it("lets unanchored ink fall to the floor", () => {
    const sim = enter(shelves);
    sim.addDrawing(drawingOf("plank", line({ x: 300, y: 300 }, { x: 400, y: 300 })));
    const drawnAt = poseOf(sim, "plank");
    runSteps(sim, 240);
    const restingAt = poseOf(sim, "plank");
    expect(drawnAt?.position).toEqual(drawnAt?.origin);
    expect(restingAt?.origin).toEqual(drawnAt?.origin);
    expect(restingAt?.position.y).toBeGreaterThan(600);
    expect(restingAt?.position.y).toBeLessThan(640);
  });

  it("holds ink that leans on paper but not ink that leans on glass", () => {
    const sim = enter(hallOfDoors);
    sim.addDrawing(drawingOf("on-paper", line({ x: 830, y: 300 }, { x: 830, y: 380 })));
    sim.addDrawing(drawingOf("on-glass", line({ x: 220, y: 500 }, { x: 220, y: 560 })));
    runSteps(sim, 120);
    expect(poseOf(sim, "on-paper")?.position.y).toBeCloseTo(340, 5);
    expect(poseOf(sim, "on-glass")?.position.y).toBeGreaterThan(560);
  });

  it("forgets a removed drawing, body and all", () => {
    const sim = enter(riverbank);
    sim.addDrawing(drawingOf("bridge", line({ x: 370, y: 556 }, { x: 610, y: 556 })));
    sim.removeDrawing(idOf("bridge"));
    expect(sim.snapshot().drawings).toEqual([]);
    sim.setWalkIntent(RIGHT);
    expect(typesOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
  });
});

describe("natures", () => {
  it("floats a balloon up even though it was anchored", () => {
    const sim = enter(shelves);
    sim.addDrawing(drawingOf("balloon", blob(400, 635, 60, 40)));
    runSteps(sim, 30);
    expect(poseOf(sim, "balloon")?.position.y).toBeCloseTo(615, 0);
    sim.applyRuling(idOf("balloon"), rulingOf("floaty"));
    runSteps(sim, 100);
    expect(poseOf(sim, "balloon")?.position.y).toBeLessThan(530);
  });

  it("freezes sticky ink where it lands", () => {
    const tiltAfterLanding = (nature: "ink" | "sticky"): number => {
      const sim = enter(shelves);
      sim.addDrawing(drawingOf("stick", line({ x: 300, y: 380 }, { x: 330, y: 500 })));
      sim.applyRuling(idOf("stick"), rulingOf(nature));
      runSteps(sim, 400);
      return Math.abs(poseOf(sim, "stick")?.angle ?? 0);
    };
    expect(tiltAfterLanding("sticky")).toBeLessThan(0.2);
    expect(tiltAfterLanding("ink")).toBeGreaterThan(1);
  });

  it("sticks a sticky shelf to paper but lets it slip off glass", () => {
    const sim = enter(hallOfDoors);
    sim.addDrawing(drawingOf("on-paper", line({ x: 810, y: 300 }, { x: 845, y: 300 })));
    sim.addDrawing(drawingOf("on-glass", line({ x: 205, y: 540 }, { x: 240, y: 540 })));
    sim.applyRuling(idOf("on-paper"), rulingOf("sticky"));
    sim.applyRuling(idOf("on-glass"), rulingOf("sticky"));
    runSteps(sim, 240);
    expect(poseOf(sim, "on-paper")?.position.y).toBeCloseTo(300, 5);
    expect(poseOf(sim, "on-glass")?.position.y).toBeGreaterThan(600);
  });

  it("refuses to grow her under a low ceiling, once per touch, and leaves the cake", () => {
    const lowCeiling: LevelDefinition = {
      ...hallOfDoors,
      solids: [
        ...hallOfDoors.solids,
        { rect: { x: 300, y: 500, width: 300, height: 60 }, material: "paper" },
      ],
    };
    const sim = enter(lowCeiling);
    sim.addDrawing(drawingOf("cake", blob(420, 635, 60, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 300);
    expect(events).toEqual([{ type: "grow-blocked", drawingId: "cake" }]);
    expect(sim.snapshot().alice.size).toBe("normal");
    expect(sim.snapshot().drawings).toHaveLength(1);
  });
});

describe("loadLevel", () => {
  it("resets key, door, size, drawings and pending events", () => {
    const sim = enter(hallOfDoors);
    sim.addDrawing(drawingOf("cake", blob(420, 635, 30, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    runUntil(sim, saw("consumed"));
    sim.setWalkIntent(LEFT);
    runUntil(sim, saw("key-taken"));
    sim.addDrawing(drawingOf("scribble", line({ x: 500, y: 300 }, { x: 560, y: 300 })));
    expect(sim.snapshot()).toMatchObject({ keyTaken: true, alice: { size: "big", hasKey: true } });

    sim.loadLevel(hallOfDoors);
    const events = runSteps(sim, 60);
    const { alice, drawings, keyTaken, doorOpen } = sim.snapshot();
    expect(events).toEqual([]);
    expect({ drawings, keyTaken, doorOpen }).toEqual({
      drawings: [],
      keyTaken: false,
      doorOpen: false,
    });
    expect(alice).toMatchObject({ size: "normal", hasKey: false, walking: false });
    expect(alice.center.x).toBeCloseTo(hallOfDoors.spawn.x, 0);
    expect(alice.height).toBeCloseTo(ALICE_BASE.height, 0);
  });
});
