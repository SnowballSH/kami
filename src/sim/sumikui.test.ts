import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { EARTH } from "../rules/types";
import { SUMIKUI_BASE_SPEED, SUMIKUI_DOUBLES_EVERY_MS, SUMIKUI_MAX_SPEED } from "./constants";
import { speedAfter } from "./sumikui";
import {
  blob,
  drawingOf,
  enter,
  idOf,
  poseOf,
  RIGHT,
  runSteps,
  runUntil,
  STAY,
  saw,
  typesOf,
} from "./testSupport";
import type { Simulation, SumikuiSnapshot } from "./types";

const board = blankBoard("sketchbook");
const GROUND = board.spawn.y;
const LOOSE = { ...EARTH, inkEater: 1 };
const A_MINUTE = 3600;

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
    const events = runSteps(sim, A_MINUTE);
    expect(typesOf(events)).not.toContain("devoured");
    expect(poseOf(sim, "bait")).toBeDefined();
    expect(poseOf(sim, "more bait")).toBeDefined();
    const { centre, phase } = sumikuiOf(sim);
    expect(phase).toBe("prowling");
    expect(Math.abs(centre.x - board.spawn.x)).toBeLessThan(200);
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
    expect(typesOf(runSteps(sim, A_MINUTE))).not.toContain("devoured");
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
