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
import type { Simulation } from "./types";

const RIGHT = { x: 1, y: 0 } as const;
const LEFT = { x: -1, y: 0 } as const;
const UP = { x: 0, y: -1 } as const;
const SHIFTS = [-20, 0, 20] as const;

const enter = (level: LevelDefinition): Simulation => {
  const sim = createSimulation();
  sim.loadLevel(level);
  return sim;
};

describe("The Riverbank", () => {
  it("drops Alice in the ditch when nothing is drawn", () => {
    const sim = enter(riverbank);
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("fell"));
    expect(typesOf(events)).toEqual(["fell"]);
    expect(sim.snapshot().alice.center.x).toBeCloseTo(riverbank.spawn.x, 0);
  });

  it("lets her cross a drawn bridge to the exit", () => {
    const sim = enter(riverbank);
    sim.addDrawing(drawingOf("bridge", line({ x: 370, y: 556 }, { x: 610, y: 556 })));
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("exit-reached"));
    expect(typesOf(events)).toEqual(["exit-reached"]);
  });
});

describe("The Shelves", () => {
  it.each(SHIFTS)("bounces her onto the ledge off a mushroom shifted %i px", (shift) => {
    const sim = enter(shelves);
    sim.addDrawing(drawingOf("mushroom", blob(630 + shift, 635, 60, 40)));
    sim.applyRuling(idOf("mushroom"), rulingOf("bouncy"));
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("exit-reached"));
    expect(typesOf(events)).toContain("bounced");
    expect(typesOf(events).at(-1)).toBe("exit-reached");
    expect(typesOf(events)).not.toContain("fell");
  });

  it("lets her climb a ladder stood against the bookcase", () => {
    const sim = enter(shelves);
    sim.addDrawing(drawingOf("ladder", line({ x: 690, y: 640 }, { x: 690, y: 395 })));
    sim.applyRuling(idOf("ladder"), rulingOf("climbable"));
    const drawnAt = sim.snapshot().drawings[0]?.pose.position;

    sim.setWalkIntent(RIGHT);
    runSteps(sim, 300);
    sim.setWalkIntent(UP);
    runSteps(sim, 100);
    expect(sim.snapshot().alice.climbing).toBe(true);
    expect(sim.snapshot().drawings[0]?.pose.position).toEqual(drawnAt);
    runSteps(sim, 50);

    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("exit-reached"));
    expect(typesOf(events)).toEqual(["exit-reached"]);
  });
});

describe("The Hall of Doors", () => {
  it.each(SHIFTS)("is solved by cake, key, bottle, door (blobs shifted %i px)", (shift) => {
    const sim = enter(hallOfDoors);
    sim.addDrawing(drawingOf("cake", blob(420 + shift, 635, 30, 24)));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    const eaten = runUntil(sim, saw("consumed"));
    expect(eaten).toEqual([{ type: "consumed", drawingId: "cake", nature: "grow" }]);
    expect(sim.snapshot().alice.size).toBe("big");
    expect(sim.snapshot().drawings).toHaveLength(0);

    sim.setWalkIntent(LEFT);
    expect(typesOf(runUntil(sim, saw("key-taken")))).toEqual(["key-taken"]);
    expect(sim.snapshot().alice.hasKey).toBe(true);
    expect(sim.snapshot().alice.height).toBeCloseTo(120, 0);

    sim.addDrawing(drawingOf("bottle", blob(520 + shift, 635, 24, 30)));
    sim.applyRuling(idOf("bottle"), rulingOf("shrink"));
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("exit-reached"));
    expect(typesOf(events)).toEqual(["consumed", "door-opened", "exit-reached"]);
    expect(sim.snapshot().alice.size).toBe("small");
    expect(sim.snapshot().doorOpen).toBe(true);
  });

  it("keeps the key out of reach of a normal-sized Alice", () => {
    const sim = enter(hallOfDoors);
    sim.setWalkIntent(LEFT);
    const events = runSteps(sim, 400);
    expect(events).toEqual([]);
    expect(sim.snapshot().alice.center.x).toBeLessThan(230);
    expect(sim.snapshot().keyTaken).toBe(false);
  });

  it("does not let a normal-sized Alice past the wall", () => {
    const sim = enter(hallOfDoors);
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 600);
    expect(events).toEqual([]);
    expect(sim.snapshot().alice.center.x).toBeLessThan(840);
    expect(sim.snapshot().doorOpen).toBe(false);
  });
});
