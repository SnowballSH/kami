import { describe, expect, it } from "vitest";
import { DEFAULT_PHYSICS } from "../core/physics";
import { riverbank } from "../game/levels/riverbank";
import { shelves } from "../game/levels/shelves";
import type { LevelDefinition } from "../game/types";
import { createSimulation } from "./index";
import { blob, drawingOf, idOf, line, rulingOf, runSteps } from "./testSupport";
import { ALICE_BASE, type Simulation } from "./types";

const RIGHT = { x: 1, y: 0 } as const;

const enter = (level: LevelDefinition): Simulation => {
  const sim = createSimulation();
  sim.loadLevel(level);
  return sim;
};

const aliceX = (sim: Simulation): number => sim.snapshot().alice.center.x;
const aliceY = (sim: Simulation): number => sim.snapshot().alice.center.y;

describe("the laws of the page", () => {
  it("start at the defaults and survive a room change", () => {
    const sim = enter(shelves);
    expect(sim.physics()).toEqual(DEFAULT_PHYSICS);

    sim.setPhysics({ gravity: { magnitudeG: 0.25, angleDeg: 90 }, walkSpeedFactor: 2 });
    sim.loadLevel(riverbank);
    expect(sim.physics().gravity.magnitudeG).toBe(0.25);
    expect(sim.physics().walkSpeedFactor).toBe(2);

    sim.resetPhysics();
    expect(sim.physics()).toEqual(DEFAULT_PHYSICS);
  });

  it("lets a faster walk factor cover more ground", () => {
    const walked = (factor: number): number => {
      const sim = enter(shelves);
      sim.setPhysics({ walkSpeedFactor: factor });
      const start = aliceX(sim);
      sim.setWalkIntent(RIGHT);
      runSteps(sim, 40);
      return aliceX(sim) - start;
    };
    expect(walked(2)).toBeGreaterThan(walked(1) * 1.5);
    expect(enter(shelves).walkSpeed()).toBeCloseTo(2.2, 5);
  });

  it("falls slower under weaker gravity and not at all under none", () => {
    const fallen = (magnitudeG: number): number => {
      const sim = enter(shelves);
      sim.setPhysics({ gravity: { magnitudeG, angleDeg: 90 } });
      sim.addDrawing(drawingOf("plank", line({ x: 120, y: 500 }, { x: 320, y: 500 })));
      sim.applyRuling(idOf("plank"), rulingOf("light"));
      const before = sim.snapshot().drawings[0]?.pose.position.y ?? 0;
      runSteps(sim, 60);
      return (sim.snapshot().drawings[0]?.pose.position.y ?? 0) - before;
    };
    expect(fallen(0)).toBeCloseTo(0, 1);
    expect(fallen(0.2)).toBeGreaterThan(1);
    expect(fallen(1)).toBeGreaterThan(fallen(0.2) * 2);
  });

  it("pulls sideways when gravity points sideways", () => {
    const sim = enter(shelves);
    sim.setPhysics({ gravity: { magnitudeG: 1, angleDeg: 0 } });
    sim.addDrawing(drawingOf("ball", blob(400, 300, 30, 30)));
    sim.applyRuling(idOf("ball"), rulingOf("light"));
    const before = sim.snapshot().drawings[0]?.pose.position ?? { x: 0, y: 0 };
    runSteps(sim, 60);
    const after = sim.snapshot().drawings[0]?.pose.position ?? { x: 0, y: 0 };
    expect(after.x).toBeGreaterThan(before.x + 40);
    expect(Math.abs(after.y - before.y)).toBeLessThan(5);
  });

  it("blows loose ink along with the wind", () => {
    const sim = enter(shelves);
    sim.addDrawing(drawingOf("ball", blob(400, 300, 30, 30)));
    sim.applyRuling(idOf("ball"), rulingOf("light"));
    sim.setPhysics({ wind: { x: 0.6, y: 0 } });
    const before = sim.snapshot().drawings[0]?.pose.position.x ?? 0;
    runSteps(sim, 120);
    expect(sim.snapshot().drawings[0]?.pose.position.x ?? 0).toBeGreaterThan(before + 40);
  });

  it("makes the floor bouncy when the page is", () => {
    const sim = enter(shelves);
    sim.setPhysics({ bounciness: 0.9, gravity: { magnitudeG: 1, angleDeg: 90 } });
    const spawnY = shelves.spawn.y - ALICE_BASE.height / 2;
    runSteps(sim, 5);
    sim.setPhysics({ gravity: { magnitudeG: 1, angleDeg: -90 } });
    runSteps(sim, 40);
    sim.setPhysics({ gravity: { magnitudeG: 1, angleDeg: 90 } });
    let lowest = aliceY(sim);
    let reboundedTo = lowest;
    for (let i = 0; i < 300; i++) {
      runSteps(sim, 1);
      const y = aliceY(sim);
      if (y > lowest) lowest = y;
      if (lowest >= spawnY - 1 && y < reboundedTo) reboundedTo = y;
    }
    expect(spawnY - reboundedTo).toBeGreaterThan(20);
  });

  it("stretches time for the whole world", () => {
    const distance = (timeScale: number): number => {
      const sim = enter(shelves);
      sim.setPhysics({ timeScale });
      const start = aliceX(sim);
      sim.setWalkIntent(RIGHT);
      runSteps(sim, 40);
      return aliceX(sim) - start;
    };
    expect(distance(2)).toBeGreaterThan(distance(1) * 1.5);
  });
});
