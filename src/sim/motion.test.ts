import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { type BodyLaw, EARTH, STILL, type Target } from "../rules/types";
import { blob, drawingOf, enter, idOf, line, poseOf, rulingOf, runSteps } from "./testSupport";
import type { Simulation } from "./types";
import { materialMoved } from "./worldPhysics";

const board = blankBoard("sketchbook");
const GROUND = board.spawn.y;
const named = (name: string): Target => ({ kind: "named", name });
const law = (of: Target, edit: BodyLaw["edit"]): BodyLaw => ({ of, edit });

const ruled = (sim: Simulation, name: string, motion?: BodyLaw["edit"]): void => {
  sim.applyRuling(idOf(name), { ...rulingOf("ink"), name, ...(motion ? { motion } : {}) });
};

const dropPebble = (sim: Simulation, name: string, x: number): void => {
  sim.addDrawing(drawingOf(name, blob(x, GROUND - 5, 24, 24)));
  ruled(sim, name);
};

const angleOf = (sim: Simulation, name: string): number => poseOf(sim, name)?.angle ?? Number.NaN;
const xOf = (sim: Simulation, name: string): number => poseOf(sim, name)?.position.x ?? Number.NaN;

describe("motion laws on drawings", () => {
  it("spins the drawing the law names, and none other", () => {
    const sim = enter(board);
    dropPebble(sim, "wheel", 200);
    dropPebble(sim, "rock", 300);
    sim.setPhysics({ ...EARTH, bodies: [law(named("wheel"), { spin: 1 })] });
    runSteps(sim, 30);
    expect(angleOf(sim, "wheel")).toBeCloseTo(Math.PI, 0);
    expect(Math.abs(angleOf(sim, "rock"))).toBeLessThan(0.1);
  });

  it("spins a held drawing in place, and stops it when the law is erased", () => {
    const sim = enter(board);
    sim.addDrawing(
      drawingOf("bridge", line({ x: -100, y: GROUND - 40 }, { x: 100, y: GROUND - 40 })),
    );
    ruled(sim, "bridge");
    sim.setPhysics({ ...EARTH, bodies: [law(named("bridge"), { spin: -1 })] });
    runSteps(sim, 15);
    const turned = angleOf(sim, "bridge");
    expect(turned).toBeCloseTo(-Math.PI / 2, 0);
    sim.setPhysics(EARTH);
    runSteps(sim, 15);
    expect(angleOf(sim, "bridge")).toBeCloseTo(turned, 1);
  });

  it("spins everything under a law on all, later laws winning", () => {
    const sim = enter(board);
    dropPebble(sim, "wheel", 200);
    dropPebble(sim, "rock", 300);
    sim.setPhysics({
      ...EARTH,
      bodies: [law({ kind: "all" }, { spin: 1 }), law(named("rock"), { spin: 0 })],
    });
    runSteps(sim, 15);
    expect(angleOf(sim, "wheel")).toBeGreaterThan(1);
    expect(Math.abs(angleOf(sim, "rock"))).toBeLessThan(0.1);
  });

  it("drives a thrusting drawing along the ground", () => {
    const sim = enter(board);
    dropPebble(sim, "cart", 200);
    dropPebble(sim, "rock", 400);
    sim.setPhysics({ ...EARTH, bodies: [law(named("cart"), { thrust: { x: 0.5, y: 0 } })] });
    runSteps(sim, 60);
    expect(xOf(sim, "cart")).toBeGreaterThan(260);
    expect(xOf(sim, "rock")).toBeCloseTo(400, 0);
  });

  it("lifts a drawing whose thrust beats gravity", () => {
    const sim = enter(board);
    dropPebble(sim, "rocket", 200);
    const restingY = poseOf(sim, "rocket")?.position.y ?? Number.NaN;
    sim.setPhysics({ ...EARTH, bodies: [law(named("rocket"), { thrust: { x: 0, y: -2 } })] });
    runSteps(sim, 60);
    expect(poseOf(sim, "rocket")?.position.y ?? Number.NaN).toBeLessThan(restingY - 100);
  });

  it("moves by its own name: a spinning wheel turns without any law", () => {
    const sim = enter(board);
    sim.addDrawing(drawingOf("wheel", blob(200, GROUND - 5, 24, 24)));
    ruled(sim, "wheel", { spin: 1 });
    runSteps(sim, 15);
    expect(angleOf(sim, "wheel")).toBeGreaterThan(1);
    sim.setPhysics({ ...EARTH, bodies: [law({ kind: "all" }, { spin: 0 })] });
    const stopped = angleOf(sim, "wheel");
    runSteps(sim, 15);
    expect(angleOf(sim, "wheel")).toBeCloseTo(stopped, 0);
  });

  it("bounces a drawing back up by its own bounce dial, while plain ink stays down", () => {
    const heightRegained = (bodies: readonly BodyLaw[]): number => {
      const sim = enter(board);
      sim.setPhysics({ ...EARTH, bodies });
      sim.addDrawing(drawingOf("ball", blob(200, GROUND - 200, 24, 24)));
      ruled(sim, "ball");
      let lowest = Number.NEGATIVE_INFINITY;
      let highestAfter = Number.POSITIVE_INFINITY;
      for (let step = 0; step < 90; step += 1) {
        runSteps(sim, 1);
        const y = poseOf(sim, "ball")?.position.y ?? Number.NaN;
        if (y > lowest) {
          lowest = y;
          highestAfter = y;
        } else highestAfter = Math.min(highestAfter, y);
      }
      return lowest - highestAfter;
    };
    const plain = heightRegained([]);
    expect(plain).toBeLessThan(10);
    expect(heightRegained([law(named("ball"), { bounce: 0.9 })])).toBeGreaterThan(plain * 3 + 15);
  });

  it("puts a drawing's weight, grip and bounce into its material", () => {
    const base = { density: 0.001, friction: 0.5, frictionAir: 0.01, restitution: 0.2 };
    expect(materialMoved(base, { ...STILL, mass: 4, grip: 0, bounce: 0.9 })).toEqual({
      density: 0.004,
      friction: 0,
      frictionAir: 0.01,
      restitution: 0.9,
    });
    expect(materialMoved(base, STILL)).toEqual(base);
  });
});
