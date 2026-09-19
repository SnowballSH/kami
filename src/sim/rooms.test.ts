import { describe, expect, it } from "vitest";
import { wonderland } from "../board/boards/wonderland";
import type { BoardDefinition } from "../board/types";
import type { Drawing } from "../ink/types";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  happeningsOf,
  idOf,
  LEFT,
  line,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  saw,
  standsOn,
  typesOf,
  UP,
  zonesOf,
} from "./testSupport";
import type { SimEvent, Simulation } from "./types";

const GROUND_TOP = 560;
const PLATEAU_TOP = 340;
const PLATEAU_FACE_X = 1500;
const WALL_X = 2500;
const RESTING = 5;
const SHIFTS = [-20, 0, 20] as const;

const startingIn = (zoneId: string, board: BoardDefinition = wonderland): Simulation => {
  const zone = board.zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) throw new Error(`no zone ${zoneId}`);
  return enter({ ...board, spawn: zone.checkpoint });
};

const bridge = (): Drawing => drawingOf("bridge", line({ x: 370, y: 556 }, { x: 610, y: 556 }));

const mushroom = (shift = 0): Drawing =>
  drawingOf("mushroom", blob(1430 + shift, GROUND_TOP - RESTING, 60, 40));

const cake = (shift = 0): Drawing =>
  drawingOf("cake", blob(1830 + shift, PLATEAU_TOP - RESTING, 30, 24));

const bottle = (shift = 0): Drawing =>
  drawingOf("bottle", blob(2150 + shift, PLATEAU_TOP - RESTING, 24, 30));

const enteredZone =
  (zoneId: string) =>
  (events: readonly SimEvent[]): boolean =>
    zonesOf(events).includes(zoneId);

describe("the ditch", () => {
  it("swallows Alice when nothing is drawn and returns her to the bank", () => {
    const sim = enter(wonderland);
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("fell"));
    expect(happeningsOf(events)).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(wonderland.spawn.x, 0);
  });

  it("is crossed on a drawn bridge without falling", () => {
    const sim = enter(wonderland);
    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(GROUND_TOP, 680));
    expect(feetOf(sim).x).toBeGreaterThanOrEqual(680);
    expect(typesOf(events)).not.toContain("fell");
  });
});

describe("the ledge", () => {
  it.each(SHIFTS)("is cleared by bouncing off a mushroom shifted %i px", (shift) => {
    const sim = startingIn("shelves");
    sim.addDrawing(mushroom(shift));
    sim.applyRuling(idOf("mushroom"), rulingOf("bouncy"));
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(PLATEAU_TOP, PLATEAU_FACE_X));
    expect(typesOf(events)).toContain("bounced");
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
  });

  it("stops her when nothing is drawn", () => {
    const sim = startingIn("shelves");
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 600);
    expect(feetOf(sim).x).toBeLessThan(PLATEAU_FACE_X);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
  });

  it("is climbed by a ladder stood against the plateau face", () => {
    const sim = startingIn("shelves");
    const ladderX = PLATEAU_FACE_X - 10;
    sim.addDrawing(
      drawingOf("ladder", line({ x: ladderX, y: GROUND_TOP }, { x: ladderX, y: PLATEAU_TOP - 25 })),
    );
    sim.applyRuling(idOf("ladder"), rulingOf("climbable"));
    const drawnAt = sim.snapshot().drawings[0]?.pose.position;

    sim.setWalkIntent(RIGHT);
    runSteps(sim, 400);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
    sim.setWalkIntent(UP);
    runSteps(sim, 100);
    expect(sim.snapshot().alice.climbing).toBe(true);
    expect(sim.snapshot().drawings[0]?.pose.position).toEqual(drawnAt);
    runSteps(sim, 50);

    sim.setWalkIntent(RIGHT);
    runUntil(sim, standsOn(PLATEAU_TOP, PLATEAU_FACE_X + 40));
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
    expect(feetOf(sim).x).toBeGreaterThan(PLATEAU_FACE_X);
  });
});

describe("the glass table and the tiny door", () => {
  it.each(SHIFTS)("are solved by cake, key, bottle, door (blobs shifted %i px)", (shift) => {
    const sim = startingIn("hall-of-doors");
    sim.addDrawing(cake(shift));
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    sim.setWalkIntent(RIGHT);
    const eaten = runUntil(sim, saw("consumed"));
    expect(happeningsOf(eaten)).toEqual(["consumed"]);
    expect(sim.snapshot().alice.size).toBe("big");
    expect(sim.snapshot().drawings).toHaveLength(0);

    expect(happeningsOf(runUntil(sim, saw("key-taken")))).toEqual(["key-taken"]);
    expect(sim.snapshot().alice.hasKey).toBe(true);
    expect(sim.snapshot().alice.height).toBeCloseTo(120, 0);
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);

    sim.addDrawing(bottle(shift));
    sim.applyRuling(idOf("bottle"), rulingOf("shrink"));
    const events = runUntil(sim, saw("goal-reached"));
    expect(typesOf(events)).toEqual(["consumed", "door-opened", "goal-reached"]);
    expect(sim.snapshot().alice.size).toBe("small");
    expect(sim.snapshot().doorOpen).toBe(true);
  });

  it("keep the key out of reach of a normal-sized Alice", () => {
    const sim = startingIn("hall-of-doors");
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 400);
    expect(feetOf(sim).x).toBeGreaterThan(2100);
    expect(typesOf(events)).not.toContain("key-taken");
    expect(sim.snapshot().keyTaken).toBe(false);
  });

  it("do not let a normal-sized Alice through the gap even with the door gone", () => {
    const { door: _door, ...doorless } = wonderland;
    const sim = enter({ ...doorless, spawn: { x: WALL_X - 200, y: PLATEAU_TOP } });
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 600);
    expect(typesOf(events)).not.toContain("goal-reached");
    expect(sim.aliceBounds().x + sim.aliceBounds().width).toBeLessThanOrEqual(WALL_X + 1);
  });
});

describe("the whole board", () => {
  it("is played from the first bank to the rabbit hole in one go", () => {
    const sim = enter(wonderland);
    const events: SimEvent[] = [];
    const play = (done: Parameters<typeof runUntil>[1]): void => {
      events.push(...runUntil(sim, done));
    };

    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    play(enteredZone("shelves"));

    sim.addDrawing(mushroom());
    sim.applyRuling(idOf("mushroom"), rulingOf("bouncy"));
    play(standsOn(PLATEAU_TOP, PLATEAU_FACE_X));
    play(enteredZone("hall-of-doors"));

    sim.addDrawing(cake());
    sim.applyRuling(idOf("cake"), rulingOf("grow"));
    play(saw("key-taken"));

    sim.addDrawing(bottle());
    sim.applyRuling(idOf("bottle"), rulingOf("shrink"));
    play(saw("goal-reached"));

    expect(zonesOf(events)).toEqual(["riverbank", "shelves", "hall-of-doors"]);
    expect(happeningsOf(events)).toEqual([
      "bounced",
      "consumed",
      "key-taken",
      "consumed",
      "door-opened",
      "goal-reached",
    ]);
  });
});

describe("zones", () => {
  it("are announced once each, however often she walks back and forth", () => {
    const sim = enter(wonderland);
    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    const events = [...runUntil(sim, standsOn(GROUND_TOP, 760))];
    sim.setWalkIntent(LEFT);
    events.push(...runSteps(sim, 80));
    sim.setWalkIntent(RIGHT);
    events.push(...runSteps(sim, 120));
    expect(zonesOf(events)).toEqual(["riverbank", "shelves"]);
  });

  it("return her to the checkpoint of the furthest zone she has reached", () => {
    const sim = enter(wonderland);
    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    runUntil(sim, enteredZone("shelves"));

    sim.removeDrawing(idOf("bridge"));
    sim.setWalkIntent(LEFT);
    const events = runUntil(sim, saw("fell"));
    expect(typesOf(events)).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(760, 0);
    runSteps(sim, 30);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
  });
});
