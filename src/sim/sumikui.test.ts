import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { strokesLength } from "../core/geometry";
import { FIXED_STEP_MS } from "../core/world";
import { EARTH } from "../rules/types";
import {
  SUMIKUI_BASE_SPEED,
  SUMIKUI_DOUBLES_EVERY_MS,
  SUMIKUI_MAX_SPEED,
  SUMIKUI_MEAL_MAX_MS,
  SUMIKUI_SCAR_HEALS_MS,
  SUMIKUI_STALKS_HER_AFTER_MS,
} from "./constants";
import { createSimulation } from "./index";
import { mealTimeFor, speedAfter } from "./sumikui";
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
  typesOf,
} from "./testSupport";
import type { SimEvent, Simulation, SumikuiSnapshot } from "./types";

const board = blankBoard("sketchbook");
const GROUND = board.spawn.y;
const LOOSE = { ...EARTH, inkEater: 1 };
const A_MINUTE = 3600;
const stepsFor = (ms: number): number => Math.ceil(ms / FIXED_STEP_MS);

const devouredIds = (events: readonly SimEvent[]): readonly string[] =>
  events.flatMap((event) => (event.type === "devoured" ? [event.drawingId] : []));

const pebble = (sim: Simulation, name: string, x: number): void =>
  sim.addDrawing(drawingOf(name, blob(x, GROUND - 5, 24, 24)));

const sumikuiOf = (sim: Simulation): SumikuiSnapshot => {
  const { sumikui } = sim.snapshot();
  if (sumikui === null) throw new Error("the Sumikui is sealed");
  return sumikui;
};

const summonOver = (drawings: readonly string[]): Simulation => {
  const sim = enter(board);
  sim.step();
  sim.setPhysics(LOOSE);
  for (const [index, name] of drawings.entries()) pebble(sim, name, 200 + index * 60);
  return sim;
};

const walkOut = (sim: Simulation, steps: number): void => {
  sim.setWalkIntent(RIGHT);
  runSteps(sim, steps);
  sim.setWalkIntent(STAY);
};

describe("the Sumikui, the ink eater", () => {
  it("is sealed under default laws and loosed by the ink-eater law", () => {
    const sim = enter(board);
    expect(sim.snapshot().sumikui).toBeNull();
    sim.setPhysics(LOOSE);
    expect(sumikuiOf(sim).phase).toBe("stirring");
    sim.setPhysics(EARTH);
    expect(sim.snapshot().sumikui).toBeNull();
  });

  it("wakes the moment it is summoned, over an empty board or not", () => {
    const roomBorn = enter(board);
    roomBorn.setPhysics(LOOSE);
    expect(sumikuiOf(roomBorn).phase).toBe("stirring");
    expect(typesOf(runSteps(roomBorn, 1))).not.toContain("sumikui-woke");

    const empty = summonOver([]);
    expect(typesOf(runSteps(empty, 1))).toContain("sumikui-woke");
    expect(sumikuiOf(empty).awakeMs).toBeGreaterThan(0);
    expect(sumikuiOf(empty).phase).toBe("prowling");
    const one = summonOver(["one"]);
    expect(typesOf(runSteps(one, 1))).toContain("sumikui-woke");
    expect(typesOf(runSteps(one, 30))).not.toContain("sumikui-woke");
  });

  it("bides in a room until the player commits edible ink", () => {
    const sim = createSimulation();
    sim.setPhysics(LOOSE);
    sim.loadBoard(board);

    expect(typesOf(runSteps(sim, stepsFor(10_000)))).not.toContain("sumikui-woke");
    expect(sumikuiOf(sim).phase).toBe("stirring");
    expect(sumikuiOf(sim).awakeMs).toBe(0);

    pebble(sim, "first drawing", 200);
    expect(typesOf(runSteps(sim, 1))).toContain("sumikui-woke");
    expect(sumikuiOf(sim).phase).not.toBe("stirring");
  });

  it("eats scribbles she never touched: clutter is ink too", () => {
    const sim = summonOver(["bait", "more bait"]);
    const events = runUntil(sim, () => poseOf(sim, "more bait") === undefined, A_MINUTE);
    expect(devouredIds(events)).toEqual(expect.arrayContaining([idOf("bait"), idOf("more bait")]));
    expect(poseOf(sim, "bait")).toBeUndefined();
  });

  it("eats named things as readily as nameless ones", () => {
    const sim = summonOver(["a cat"]);
    sim.applyRuling(idOf("a cat"), rulingOf("walker"));
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    expect(devouredIds(events)).toEqual([idOf("a cat")]);
    expect(poseOf(sim, "a cat")).toBeUndefined();
  });

  it("spares named drawings during its opening window when nameless ink is nearby", () => {
    const sim = summonOver(["a cat", "clutter"]);
    sim.applyRuling(idOf("a cat"), rulingOf("walker"));
    const events = runSteps(sim, stepsFor(SUMIKUI_STALKS_HER_AFTER_MS) - 1);
    expect(devouredIds(events)).toContain(idOf("clutter"));
    expect(devouredIds(events)).not.toContain(idOf("a cat"));
    expect(poseOf(sim, "a cat")).toBeDefined();
  });

  it("prefers the drawing Alice leans on to the scribble farther off", () => {
    const sim = summonOver(["bait"]);
    pebble(sim, "her rock", 60);
    walkOut(sim, 45);
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    expect(events).toContainEqual({ type: "devoured", drawingId: idOf("her rock"), nature: "ink" });
    expect(poseOf(sim, "her rock")).toBeUndefined();
    expect(poseOf(sim, "bait")).toBeDefined();
  });

  it("shows what it chews: the drawing between its teeth and how far through it is", () => {
    const sim = summonOver(["bait"]);
    pebble(sim, "her rock", 60);
    walkOut(sim, 45);
    runUntil(sim, () => sumikuiOf(sim).phase === "feeding", A_MINUTE);
    const { chewing, bite, quarry } = sumikuiOf(sim);
    expect(quarry).toBe("ink");
    expect(chewing).toBe(idOf("her rock"));
    expect(bite).toBeGreaterThan(0);
    expect(bite).toBeLessThanOrEqual(1);
  });

  it("chews steadily: the bite climbs from nothing to whole across the meal", () => {
    const sim = summonOver(["bait"]);
    runUntil(sim, () => sumikuiOf(sim).phase === "feeding", A_MINUTE);
    const bites: number[] = [];
    runUntil(
      sim,
      (events) => {
        bites.push(sumikuiOf(sim).bite);
        return events.some((event) => event.type === "devoured");
      },
      A_MINUTE,
    );
    const climbing = bites.slice(0, -1);
    expect(climbing.length).toBeGreaterThan(10);
    expect(climbing.every((bite, i) => i === 0 || bite >= (climbing[i - 1] ?? 0))).toBe(true);
    expect(climbing.at(-1)).toBeGreaterThan(0.9);
  });

  it("counts ink under a clone as hers, so no platform is eaten from beneath a twin", () => {
    const sim = enter(board);
    sim.setPhysics({ ...LOOSE, clones: 1 });
    pebble(sim, "bait", 400);
    runSteps(sim, 30);
    const [twin] = sim.snapshot().twins;
    if (twin === undefined) throw new Error("no twin walks beside her");
    sim.addDrawing(drawingOf("her twin's rock", blob(twin.center.x, GROUND - 5, 60, 24)));
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    expect(events).toContainEqual({
      type: "devoured",
      drawingId: idOf("her twin's rock"),
      nature: "ink",
    });
    expect(poseOf(sim, "bait")).toBeDefined();
  });

  it("never eats roles: a goal is part of the board, not her ink", () => {
    const sim = summonOver(["bait"]);
    pebble(sim, "the door", 60);
    sim.applyRuling(idOf("the door"), rulingOf("goal"));
    walkOut(sim, 45);
    expect(devouredIds(runSteps(sim, A_MINUTE))).not.toContain(idOf("the door"));
    expect(poseOf(sim, "the door")).toBeDefined();
  });

  it("spares the props Kami dresses a scene with, and eats the ink drawn beside them", () => {
    const sim = enter(board);
    sim.setPhysics(LOOSE);
    sim.addDrawing(drawingOf("a prop", blob(200, GROUND - 5, 24, 24)), "scenery");
    pebble(sim, "a doodle", 260);
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    expect(devouredIds(events)).toEqual([idOf("a doodle")]);
    expect(devouredIds(runSteps(sim, A_MINUTE))).toEqual([]);
    expect(poseOf(sim, "a prop")).toBeDefined();
  });

  it("forgets its hunger when sealed, and wakes fresh when loosed again", () => {
    const sim = summonOver(["one", "two"]);
    runSteps(sim, 120);
    const before = sumikuiOf(sim).awakeMs;
    expect(before).toBeGreaterThan(0);
    sim.setPhysics(EARTH);
    runSteps(sim, 120);
    sim.setPhysics(LOOSE);
    runSteps(sim, 1);
    expect(sumikuiOf(sim).awakeMs).toBeLessThan(before);
  });

  it.each(["goal", "spawn", "solid"] as const)(
    "abandons a target renamed to %s during hunting or feeding",
    (nature) => {
      for (const phase of ["hunting", "feeding"] as const) {
        const sim = summonOver(["bait"]);
        pebble(sim, "her rock", 60);
        walkOut(sim, 45);
        runUntil(sim, () => sumikuiOf(sim).phase === phase, A_MINUTE);
        expect(sumikuiOf(sim).phase).toBe(phase);
        sim.applyRuling(idOf("her rock"), rulingOf(nature));
        runSteps(sim, 1);
        expect(sumikuiOf(sim).chewing).toBeNull();
        expect(devouredIds(runSteps(sim, A_MINUTE))).not.toContain(idOf("her rock"));
        expect(poseOf(sim, "her rock")).toBeDefined();
      }
    },
  );
});

describe("everything on the paper is ink to it", () => {
  it("never bites the ground, nor her, where Kami sets her down", () => {
    const sim = summonOver([]);
    const events = runSteps(sim, A_MINUTE);
    expect(typesOf(events)).not.toContain("paper-bitten");
    expect(typesOf(events)).not.toContain("alice-devoured");
    expect(sim.snapshot().bites).toEqual([]);
  });

  it("bites the board's own ground out from under her, and she falls through the hole", () => {
    const sim = summonOver([]);
    runSteps(sim, stepsFor(SUMIKUI_STALKS_HER_AFTER_MS));
    walkOut(sim, 60);
    const feet = feetOf(sim);
    const events = runUntil(sim, saw("fell"), A_MINUTE);
    const bitten = events.find((event) => event.type === "paper-bitten");
    if (bitten === undefined || bitten.type !== "paper-bitten") throw new Error("no bite taken");
    expect(bitten.hole.x).toBeLessThan(feet.x);
    expect(bitten.hole.x + bitten.hole.width).toBeGreaterThan(feet.x);
    expect(typesOf(events)).toContain("fell");
    expect(sim.snapshot().bites).toEqual([bitten.hole]);
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x);
  });

  it("charts the hole for the pilot and heals it in time", () => {
    const sim = summonOver([]);
    runSteps(sim, stepsFor(SUMIKUI_STALKS_HER_AFTER_MS));
    walkOut(sim, 60);
    runUntil(sim, saw("paper-bitten"), A_MINUTE);
    expect(sim.snapshot().bites).toHaveLength(1);
    const events = runUntil(sim, saw("paper-healed"), stepsFor(SUMIKUI_SCAR_HEALS_MS) + 60);
    expect(typesOf(events)).toContain("paper-healed");
    expect(sim.snapshot().bites).toEqual([]);
  });

  it("devours Alice herself when she stands where there is nothing else to eat", () => {
    const sim = summonOver([]);
    sim.addDrawing(drawingOf("a ledge", blob(400, GROUND - 40, 200, 24)));
    sim.applyRuling(idOf("a ledge"), rulingOf("solid"));
    sim.setPhysics({ ...LOOSE, flight: 1 });
    sim.setWalkIntent({ x: 1, y: -1 });
    runUntil(sim, () => feetOf(sim).x > 380, A_MINUTE);
    sim.setWalkIntent(STAY);
    const graceSteps = stepsFor(Math.max(0, SUMIKUI_STALKS_HER_AFTER_MS - sumikuiOf(sim).awakeMs));
    expect(typesOf(runSteps(sim, Math.max(0, graceSteps - 1)))).not.toContain("alice-devoured");
    const events = runUntil(sim, saw("alice-devoured"), A_MINUTE);
    expect(typesOf(events)).toContain("alice-devoured");
    expect(typesOf(events)).toContain("fell");
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x);
    expect(sumikuiOf(sim).phase).toBe("sated");
    expect(sumikuiOf(sim).awakeMs).toBeLessThan(1000);
  });

  it("devours only the twin it catches, and names her; Alice keeps her footing", () => {
    const sim = summonOver([]);
    sim.setPhysics({ ...LOOSE, flight: 1, clones: 1 });
    sim.addDrawing(drawingOf("a ledge", blob(400, GROUND - 40, 200, 24)));
    sim.applyRuling(idOf("a ledge"), rulingOf("solid"));
    runSteps(sim, 30);
    sim.setWalkIntent({ x: 1, y: -1 }, 1);
    runUntil(sim, () => sim.aliceBounds(1).x > 380, A_MINUTE);
    sim.setWalkIntent(STAY, 1);
    const herself = feetOf(sim).x;
    runSteps(sim, stepsFor(SUMIKUI_STALKS_HER_AFTER_MS));
    runUntil(sim, () => sumikuiOf(sim).prey === 1, A_MINUTE);
    expect(sumikuiOf(sim).prey).toBe(1);
    const events = runUntil(sim, saw("alice-devoured"), A_MINUTE);
    expect(events).toContainEqual({ type: "alice-devoured", who: 1 });
    expect(events).toContainEqual({ type: "fell", who: 1 });
    expect(events.filter((event) => event.type === "fell")).toHaveLength(1);
    expect(feetOf(sim).x).toBeCloseTo(herself, 0);
  });

  it("hunts a drawing before Alice during its first twenty seconds awake", () => {
    const sim = enter(board);
    sim.step();
    pebble(sim, "first drawing", 200);
    sim.setPhysics(LOOSE);
    expect(typesOf(runSteps(sim, 1))).toContain("sumikui-woke");

    const events = runSteps(sim, stepsFor(SUMIKUI_STALKS_HER_AFTER_MS) - 1);
    expect(devouredIds(events)).toContain(idOf("first drawing"));
    expect(typesOf(events)).not.toContain("alice-devoured");
  });

  it("devours Alice after twenty seconds awake when no drawing remains", () => {
    const sim = summonOver([]);
    sim.addDrawing(drawingOf("a ledge", blob(400, GROUND - 40, 200, 24)));
    sim.applyRuling(idOf("a ledge"), rulingOf("solid"));
    sim.setPhysics({ ...LOOSE, flight: 1 });
    sim.setWalkIntent({ x: 1, y: -1 });
    runUntil(sim, () => feetOf(sim).x > 380, A_MINUTE);
    sim.setWalkIntent(STAY);

    const graceSteps = stepsFor(Math.max(0, SUMIKUI_STALKS_HER_AFTER_MS - sumikuiOf(sim).awakeMs));
    expect(typesOf(runSteps(sim, Math.max(0, graceSteps - 1)))).not.toContain("alice-devoured");
    expect(typesOf(runUntil(sim, saw("alice-devoured"), A_MINUTE))).toContain("alice-devoured");
  });
});

describe("its meals", () => {
  const feedingSteps = (sim: Simulation): number => {
    runUntil(sim, () => sumikuiOf(sim).phase === "feeding", A_MINUTE);
    let steps = 0;
    runUntil(
      sim,
      (events) => {
        steps += 1;
        return events.some((event) => event.type === "devoured");
      },
      A_MINUTE,
    );
    return steps;
  };

  it("take about a second and a half over a pebble, several over a long bridge, never past the cap", () => {
    expect(mealTimeFor(strokesLength([blob(0, 0, 24, 24)]))).toBeGreaterThan(1200);
    expect(mealTimeFor(strokesLength([blob(0, 0, 24, 24)]))).toBeLessThan(1800);
    expect(mealTimeFor(500)).toBeGreaterThan(4000);
    expect(mealTimeFor(500)).toBeLessThan(SUMIKUI_MEAL_MAX_MS);
    expect(mealTimeFor(5000)).toBe(SUMIKUI_MEAL_MAX_MS);
  });

  it("grow with the drawing: a bridge keeps it busy far longer than a pebble", () => {
    const overAPebble = summonOver(["a pebble"]);
    const overABridge = summonOver([]);
    overABridge.addDrawing(
      drawingOf("a bridge", line({ x: 150, y: GROUND - 5 }, { x: 650, y: GROUND - 5 })),
    );
    const pebbleSteps = feedingSteps(overAPebble);
    const bridgeSteps = feedingSteps(overABridge);
    expect(pebbleSteps * FIXED_STEP_MS).toBeGreaterThan(1200);
    expect(pebbleSteps * FIXED_STEP_MS).toBeLessThan(1800);
    expect(bridgeSteps).toBeGreaterThan(pebbleSteps * 2.5);
    expect(poseOf(overABridge, "a bridge")).toBeUndefined();
  });
});

describe("its pace", () => {
  it("doubles every so often awake, and never outruns the cap", () => {
    expect(speedAfter(0)).toBe(SUMIKUI_BASE_SPEED);
    expect(speedAfter(SUMIKUI_DOUBLES_EVERY_MS)).toBeCloseTo(SUMIKUI_BASE_SPEED * 2);
    expect(speedAfter(2 * SUMIKUI_DOUBLES_EVERY_MS)).toBeCloseTo(SUMIKUI_BASE_SPEED * 4);
    expect(speedAfter(60 * SUMIKUI_DOUBLES_EVERY_MS)).toBe(SUMIKUI_MAX_SPEED);
    expect(speedAfter(Number.POSITIVE_INFINITY)).toBe(SUMIKUI_MAX_SPEED);
  });
});
