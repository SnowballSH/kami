import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { poseToWorld, type Stroke } from "../core/geometry";
import { type BodyLaw, EARTH, type Target } from "../rules/types";
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
} from "./testSupport";
import type { Simulation, WalkIntent } from "./types";

const UP_AND_RIGHT: WalkIntent = { x: 1, y: -1 };

const board = blankBoard("menagerie");
const GROUND = board.spawn.y;
const SETTLE_STEPS = 60;
const named = (name: string): Target => ({ kind: "named", name });
const law = (of: Target, edit: BodyLaw["edit"]): BodyLaw => ({ of, edit });

const centreOf = (sim: Simulation, name: string) => {
  const pose = poseOf(sim, name);
  if (pose === undefined) throw new Error(`${name} is gone`);
  return pose;
};

const drawn = new Map<string, readonly Stroke[]>();

const draw = (sim: Simulation, name: string, ...strokes: readonly Stroke[]): void => {
  drawn.set(name, strokes);
  sim.addDrawing(drawingOf(name, ...strokes));
};

const worldBoundsOf = (sim: Simulation, name: string) => {
  const pose = centreOf(sim, name);
  const points = (drawn.get(name) ?? []).flat().map((point) => poseToWorld(point, pose));
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
};

const settleCreature = (name: string, nature: "walker" | "hopper", centreX: number) => {
  const sim = enter(board);
  sim.setWalkIntent(STAY);
  draw(sim, name, blob(centreX, GROUND - 5, 50, 36));
  runSteps(sim, SETTLE_STEPS);
  sim.applyRuling(idOf(name), { ...rulingOf(nature), name });
  runSteps(sim, 30);
  return sim;
};

const distanceWalked = (sim: Simulation, name: string, steps: number): number => {
  let walked = 0;
  for (let step = 0; step < steps; step++) {
    const from = centreOf(sim, name).position.x;
    sim.step();
    walked += Math.abs(centreOf(sim, name).position.x - from);
  }
  return walked;
};

describe("pace", () => {
  it("makes the cat the law names twice as fast, and no other creature", () => {
    const sim = settleCreature("cat", "walker", 100);
    sim.addDrawing(drawingOf("dog", blob(-150, GROUND - 5, 50, 36)));
    runSteps(sim, SETTLE_STEPS);
    sim.applyRuling(idOf("dog"), { ...rulingOf("walker"), name: "dog" });
    runSteps(sim, 30);
    const plainCat = distanceWalked(sim, "cat", 30);
    const plainDog = distanceWalked(sim, "dog", 30);
    sim.setPhysics({ ...EARTH, bodies: [law(named("cat"), { pace: 2 })] });
    runSteps(sim, 5);
    expect(distanceWalked(sim, "cat", 30)).toBeCloseTo(plainCat * 2, -1);
    expect(distanceWalked(sim, "dog", 30)).toBeCloseTo(plainDog, -1);
  });
});

describe("wings", () => {
  it("lifts a walker off the ground and it flies about instead of pacing", () => {
    const sim = settleCreature("dog", "walker", 100);
    const grounded = centreOf(sim, "dog").position.y;
    sim.setPhysics({ ...EARTH, bodies: [law(named("dog"), { wings: 1 })] });
    runSteps(sim, 90);
    const flown = centreOf(sim, "dog");
    expect(flown.position.y).toBeLessThan(grounded - 40);
    expect(Math.abs(flown.angle)).toBeLessThan(0.05);
  });

  it("grounds the dog again when the law is repealed", () => {
    const sim = settleCreature("dog", "walker", 100);
    const grounded = centreOf(sim, "dog").position.y;
    sim.setPhysics({ ...EARTH, bodies: [law(named("dog"), { wings: 1 })] });
    runSteps(sim, 90);
    sim.setPhysics(EARTH);
    runSteps(sim, 120);
    expect(centreOf(sim, "dog").position.y).toBeCloseTo(grounded, 0);
  });

  it("hangs a plain drawing in the air where it is, rather than letting it fall", () => {
    const sim = enter(board);
    sim.setWalkIntent(STAY);
    sim.addDrawing(drawingOf("rock", blob(200, GROUND - 200, 30, 30)));
    sim.applyRuling(idOf("rock"), { ...rulingOf("ink"), name: "rock" });
    sim.setPhysics({ ...EARTH, bodies: [law(named("rock"), { wings: 1 })] });
    const hung = centreOf(sim, "rock").position.y;
    runSteps(sim, 120);
    expect(centreOf(sim, "rock").position.y).toBeCloseTo(hung, 0);
  });

  it("lets Alice steer a winged car up into the sky", () => {
    const cart: readonly Stroke[] = [
      line({ x: 35, y: -14 }, { x: 125, y: -14 }),
      blob(50, -2, 16, 12),
      blob(110, -2, 16, 12),
    ];
    const sim = enter(board);
    sim.setWalkIntent(STAY);
    sim.addDrawing(drawingOf("car", ...cart));
    sim.applyRuling(idOf("car"), { ...rulingOf("vehicle"), name: "car" });
    runSteps(sim, 60);
    sim.setWalkIntent(RIGHT);
    runUntil(
      sim,
      (_events, current) => current.snapshot().alice.grounded && feetOf(current).x > 60,
    );
    sim.setWalkIntent(STAY);
    const parked = centreOf(sim, "car").position.y;
    sim.setPhysics({ ...EARTH, bodies: [law(named("car"), { wings: 1 })] });
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 10);
    sim.setWalkIntent(UP_AND_RIGHT);
    runSteps(sim, 60);
    expect(centreOf(sim, "car").position.y).toBeLessThan(parked - 60);
    expect(feetOf(sim).y).toBeLessThan(parked);
  });
});

describe("size", () => {
  it("doubles the rabbit about its centre, keeping its feet on the ground", () => {
    const sim = settleCreature("rabbit", "hopper", 100);
    sim.setPhysics({ ...EARTH, bodies: [law({ kind: "all" }, { pace: 0.1 })] });
    const before = worldBoundsOf(sim, "rabbit");
    sim.setPhysics({
      ...EARTH,
      bodies: [law({ kind: "all" }, { pace: 0.1 }), law(named("rabbit"), { size: 2 })],
    });
    const after = worldBoundsOf(sim, "rabbit");
    expect(after.right - after.left).toBeCloseTo((before.right - before.left) * 2, 0);
    expect(after.bottom - after.top).toBeCloseTo((before.bottom - before.top) * 2, 0);
    expect(after.bottom).toBeCloseTo(before.bottom, 0);
    expect(centreOf(sim, "rabbit").scale).toBe(2);
  });

  it("shrinks it back when the law is repealed, and leaves other drawings alone", () => {
    const sim = enter(board);
    sim.setWalkIntent(STAY);
    draw(sim, "rabbit", blob(100, GROUND - 5, 50, 36));
    draw(sim, "rock", blob(-200, GROUND - 5, 30, 30));
    sim.applyRuling(idOf("rabbit"), { ...rulingOf("ink"), name: "rabbit" });
    sim.applyRuling(idOf("rock"), { ...rulingOf("ink"), name: "rock" });
    runSteps(sim, SETTLE_STEPS);
    const rabbit = worldBoundsOf(sim, "rabbit");
    const rock = worldBoundsOf(sim, "rock");
    sim.setPhysics({ ...EARTH, bodies: [law(named("rabbit"), { size: 3 })] });
    runSteps(sim, SETTLE_STEPS);
    const untouched = worldBoundsOf(sim, "rock");
    expect(untouched.right - untouched.left).toBeCloseTo(rock.right - rock.left, 0);
    expect(untouched.bottom).toBeCloseTo(rock.bottom, 0);
    const grown = worldBoundsOf(sim, "rabbit");
    expect(grown.right - grown.left).toBeCloseTo((rabbit.right - rabbit.left) * 3, 0);
    sim.setPhysics(EARTH);
    runSteps(sim, SETTLE_STEPS);
    const shrunk = worldBoundsOf(sim, "rabbit");
    expect(shrunk.right - shrunk.left).toBeCloseTo(rabbit.right - rabbit.left, 0);
    expect(shrunk.bottom).toBeCloseTo(rabbit.bottom, 0);
  });

  it("carries Alice on the back of a huge, fast dog", () => {
    const sim = enter(board);
    sim.setWalkIntent(STAY);
    sim.addDrawing(drawingOf("dog", line({ x: 30, y: GROUND - 4 }, { x: 250, y: GROUND - 4 })));
    runSteps(sim, SETTLE_STEPS);
    sim.setWalkIntent(RIGHT);
    runUntil(sim, (_, current) => current.aliceBounds().x > 120);
    sim.setWalkIntent(STAY);
    sim.applyRuling(idOf("dog"), { ...rulingOf("walker"), name: "dog" });
    sim.setPhysics({ ...EARTH, bodies: [law(named("dog"), { size: 1.5, pace: 2 })] });
    runSteps(sim, 30);
    const before = { alice: feetOf(sim).x, dog: centreOf(sim, "dog").position.x };
    runSteps(sim, 60);
    const after = { alice: feetOf(sim).x, dog: centreOf(sim, "dog").position.x };
    const carried = after.dog - before.dog;
    expect(Math.abs(carried)).toBeGreaterThan(80);
    expect(after.alice - before.alice).toBeCloseTo(carried, -1);
  });
});
