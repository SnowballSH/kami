import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { FIXED_STEP_MS } from "../core/world";
import { EARTH } from "../rules/types";
import {
  SUMIKUI_BASE_SPEED,
  SUMIKUI_DOUBLES_EVERY_MS,
  SUMIKUI_MAX_SPEED,
  SUMIKUI_SCAR_HEALS_MS,
  SUMIKUI_SWEEPS_AFTER_MS,
} from "./constants";
import { speedAfter } from "./sumikui";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  idOf,
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
const BEFORE_SWEEPING = stepsFor(SUMIKUI_SWEEPS_AFTER_MS) - 60;

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
  sim.setPhysics(LOOSE);
  for (const [index, name] of drawings.entries()) pebble(sim, name, 200 + index * 60);
  return sim;
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

  it("only stirs once the board holds a second drawing", () => {
    const sim = summonOver(["one"]);
    expect(typesOf(runSteps(sim, 30))).not.toContain("sumikui-woke");
    expect(sumikuiOf(sim).awakeMs).toBe(0);
    pebble(sim, "two", 260);
    expect(typesOf(runSteps(sim, 2))).toContain("sumikui-woke");
    expect(sumikuiOf(sim).awakeMs).toBeGreaterThan(0);
  });

  it("stays at Alice's shoulder and ignores scribbles she has never used", () => {
    const sim = summonOver(["bait", "more bait"]);
    const events = runSteps(sim, BEFORE_SWEEPING);
    expect(typesOf(events)).not.toContain("devoured");
    expect(poseOf(sim, "bait")).toBeDefined();
    expect(poseOf(sim, "more bait")).toBeDefined();
    const { centre, phase } = sumikuiOf(sim);
    expect(phase).toBe("prowling");
    expect(Math.abs(centre.x - board.spawn.x)).toBeLessThan(200);
  });

  it("once quick, sweeps the clutter she never used in one gulp rather than stalking it", () => {
    const sim = summonOver(["bait", "more bait"]);
    runSteps(sim, BEFORE_SWEEPING);
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    const gulp = events.find((event) => event.type === "devoured");
    expect(gulp).toBeDefined();
    expect(sumikuiOf(sim).awakeMs).toBeGreaterThanOrEqual(SUMIKUI_SWEEPS_AFTER_MS);
    runUntil(sim, saw("devoured"), A_MINUTE);
    expect(poseOf(sim, "bait")).toBeUndefined();
    expect(poseOf(sim, "more bait")).toBeUndefined();
  });

  it("leaves named things alone when sweeping: only nameless ink is clutter", () => {
    const sim = summonOver(["bait", "a cat"]);
    sim.applyRuling(idOf("a cat"), rulingOf("walker"));
    runSteps(sim, BEFORE_SWEEPING);
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    expect(devouredIds(events)).toEqual([idOf("bait")]);
    expect(poseOf(sim, "a cat")).toBeDefined();
  });

  it("shows what it chews: the drawing between its teeth and how far through it is", () => {
    const sim = summonOver(["bait"]);
    pebble(sim, "her rock", 60);
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 45);
    sim.setWalkIntent(STAY);
    runUntil(sim, () => sumikuiOf(sim).phase === "feeding", A_MINUTE);
    const { chewing, bite, quarry } = sumikuiOf(sim);
    expect(quarry).toBe("ink");
    expect(chewing).toBe(idOf("her rock"));
    expect(bite).toBeGreaterThan(0);
    expect(bite).toBeLessThanOrEqual(1);
  });

  it.each(["hunting", "feeding"] as const)("spares untouched clutter renamed while %s", (phase) => {
    const sim = summonOver(["bait", "more bait"]);
    runSteps(sim, BEFORE_SWEEPING);
    runUntil(sim, () => sumikuiOf(sim).phase === phase, A_MINUTE);
    expect(sumikuiOf(sim).phase).toBe(phase);
    sim.applyRuling(idOf("bait"), rulingOf("bouncy"));
    const events = runSteps(sim, 120);
    expect(devouredIds(events)).not.toContain(idOf("bait"));
    expect(poseOf(sim, "bait")).toBeDefined();
  });

  it("devours the drawing Alice leans on, and not the scribble beside it", () => {
    const sim = summonOver(["bait"]);
    pebble(sim, "her rock", 60);
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 45);
    sim.setWalkIntent(STAY);
    const events = runUntil(sim, saw("devoured"), A_MINUTE);
    expect(events).toContainEqual({ type: "devoured", drawingId: idOf("her rock"), nature: "ink" });
    expect(poseOf(sim, "her rock")).toBeUndefined();
    expect(poseOf(sim, "bait")).toBeDefined();
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
    sim.applyRuling(idOf("the door"), {
      name: "goal",
      nature: "goal",
      strength: 1,
      tags: [],
      line: "",
    });
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 45);
    sim.setWalkIntent(STAY);
    expect(devouredIds(runSteps(sim, A_MINUTE))).not.toContain(idOf("the door"));
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
        sim.setWalkIntent(RIGHT);
        runSteps(sim, 45);
        sim.setWalkIntent(STAY);
        runUntil(sim, () => sumikuiOf(sim).phase === phase, A_MINUTE);
        expect(sumikuiOf(sim).phase).toBe(phase);
        sim.applyRuling(idOf("her rock"), {
          name: nature,
          nature,
          strength: 1,
          tags: [],
          line: "",
        });
        runSteps(sim, 1);
        expect(sumikuiOf(sim).chewing).toBeNull();
        expect(devouredIds(runSteps(sim, A_MINUTE))).not.toContain(idOf("her rock"));
        expect(poseOf(sim, "her rock")).toBeDefined();
      }
    },
  );
});

describe("everything on the paper is ink to it", () => {
  const walkOut = (sim: Simulation, steps: number): void => {
    sim.setWalkIntent(RIGHT);
    runSteps(sim, steps);
    sim.setWalkIntent(STAY);
  };

  it("never bites the ground, nor her, where Kami sets her down", () => {
    const sim = summonOver(["one", "two"]);
    const events = runSteps(sim, BEFORE_SWEEPING);
    expect(typesOf(events)).not.toContain("paper-bitten");
    expect(typesOf(events)).not.toContain("alice-devoured");
    expect(sim.snapshot().bites).toEqual([]);
  });

  it("bites the board's own ground out from under her, and she falls through the hole", () => {
    const sim = summonOver(["one", "two"]);
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
    const sim = summonOver(["one", "two"]);
    walkOut(sim, 60);
    runUntil(sim, saw("paper-bitten"), A_MINUTE);
    expect(sim.snapshot().bites).toHaveLength(1);
    const events = runUntil(sim, saw("paper-healed"), stepsFor(SUMIKUI_SCAR_HEALS_MS) + 60);
    expect(typesOf(events)).toContain("paper-healed");
    expect(sim.snapshot().bites).toEqual([]);
  });

  it("devours Alice herself when she stands where there is nothing else to eat", () => {
    const sim = summonOver(["one", "two"]);
    sim.addDrawing(drawingOf("a ledge", blob(400, GROUND - 40, 200, 24)));
    sim.applyRuling(idOf("a ledge"), rulingOf("solid"));
    sim.setPhysics({ ...LOOSE, flight: 1 });
    sim.setWalkIntent({ x: 1, y: -1 });
    runUntil(sim, () => feetOf(sim).x > 380, A_MINUTE);
    sim.setWalkIntent(STAY);
    const events = runUntil(sim, saw("alice-devoured"), A_MINUTE);
    expect(typesOf(events)).toContain("alice-devoured");
    expect(typesOf(events)).toContain("fell");
    expect(feetOf(sim).x).toBeCloseTo(board.spawn.x);
    expect(sumikuiOf(sim).phase).toBe("sated");
    expect(sumikuiOf(sim).awakeMs).toBeLessThan(1000);
  });

  it("devours only the twin it catches, and names her; Alice keeps her footing", () => {
    const sim = summonOver(["one", "two"]);
    sim.setPhysics({ ...LOOSE, flight: 1, clones: 1 });
    sim.addDrawing(drawingOf("a ledge", blob(400, GROUND - 40, 200, 24)));
    sim.applyRuling(idOf("a ledge"), rulingOf("solid"));
    runSteps(sim, 30);
    sim.setWalkIntent({ x: 1, y: -1 }, 1);
    runUntil(sim, () => sim.aliceBounds(1).x > 380, A_MINUTE);
    sim.setWalkIntent(STAY, 1);
    const herself = feetOf(sim).x;
    runUntil(sim, () => sumikuiOf(sim).prey === 1, A_MINUTE);
    expect(sumikuiOf(sim).prey).toBe(1);
    const events = runUntil(sim, saw("alice-devoured"), A_MINUTE);
    expect(events).toContainEqual({ type: "alice-devoured", who: 1 });
    expect(events).toContainEqual({ type: "fell", who: 1 });
    expect(events.filter((event) => event.type === "fell")).toHaveLength(1);
    expect(feetOf(sim).x).toBeCloseTo(herself, 0);
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
