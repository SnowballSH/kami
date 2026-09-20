import { describe, expect, it } from "vitest";
import type { Vec } from "../../core/geometry";
import { EARTH } from "../../rules/types";
import { toWorldSpace } from "../body/drawnBody";
import { EMPTY_BOARD } from "../emptyBoard";
import {
  aliceOf,
  drawingOf,
  enter,
  idOf,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  saw,
  typesOf,
} from "../testSupport";
import type { Simulation } from "../types";
import { figureAround, legsBelow, ringAround, strokeBetween } from "./figure.testSupport";
import { TEAR_TUNING } from "./tuning";

const soulOf = (sim: Simulation): Vec => {
  const soul = sim.snapshot().soul;
  if (soul === null) throw new Error("Somebody is on the board");
  return soul.at;
};

const openAsSoul = (): Simulation => {
  const sim = enter(EMPTY_BOARD);
  sim.disembody();
  return sim;
};

const incarnateFigure = (sim: Simulation, name = "alice"): Vec => {
  const heart = soulOf(sim);
  sim.addDrawing(drawingOf("body", ...figureAround(heart)));
  expect(sim.incarnate(idOf("body"), name)).toBe(true);
  return heart;
};

const drawnLook = (sim: Simulation) => {
  const look = aliceOf(sim).look;
  if (look.kind !== "drawn") throw new Error("She wears Kami's own sketch");
  return look;
};

const heartOf = (sim: Simulation): Vec => {
  const { center, facing } = aliceOf(sim);
  const look = drawnLook(sim);
  return toWorldSpace(look.body.heart, { centre: center, facing, scale: look.scale });
};

describe("a soul with no body", () => {
  it("opens with nobody on the board and a soul where she would have stood", () => {
    const sim = openAsSoul();
    const world = sim.snapshot();
    expect(world.alice).toBeNull();
    expect(world.soul).not.toBeNull();
    expect(soulOf(sim).x).toBeCloseTo(EMPTY_BOARD.spawn.x, 0);
    expect(soulOf(sim).y).toBeLessThan(EMPTY_BOARD.spawn.y);
  });

  it("stays a soul through time and intent, and cannot be grafted onto", () => {
    const sim = openAsSoul();
    sim.setWalkIntent(RIGHT);
    const before = soulOf(sim);
    runSteps(sim, 60);
    expect(sim.snapshot().alice).toBeNull();
    expect(soulOf(sim)).toEqual(before);
    expect(sim.graft([strokeBetween(before, { x: before.x + 30, y: before.y })])).toBe(false);
  });

  it("becomes the body a drawing gives it, and the drawing is no longer ink", () => {
    const sim = openAsSoul();
    incarnateFigure(sim);
    const world = sim.snapshot();
    expect(world.soul).toBeNull();
    expect(world.alice).not.toBeNull();
    expect(world.drawings.some((pose) => pose.id === idOf("body"))).toBe(false);
    const look = drawnLook(sim);
    expect(look.body.strokes).toHaveLength(6);
    expect(look.abilities).toEqual({ walk: true, jump: true, climb: true, fly: false, see: true });
  });

  it("is nobody to steer, a clone law makes no twins of a soul, and her twins wear Kami's sketch", () => {
    const sim = openAsSoul();
    expect(sim.alices()).toEqual([]);
    sim.setPhysics({ ...EARTH, clones: 2 });
    runSteps(sim, 5);
    expect(sim.alices()).toEqual([]);
    expect(sim.snapshot().twins).toEqual([]);
    const frame = sim.aliceBounds();
    const heart = soulOf(sim);
    expect(frame.x).toBeLessThan(heart.x);
    expect(frame.x + frame.width).toBeGreaterThan(heart.x);

    incarnateFigure(sim);
    runSteps(sim, 5);
    expect(sim.alices()).toHaveLength(3);
    expect(sim.alices().map((alice) => alice.look.kind)).toEqual(["drawn", "alice", "alice"]);
  });

  it("will not incarnate a drawing that is not there", () => {
    const sim = openAsSoul();
    expect(sim.incarnate(idOf("nobody"), "alice")).toBe(false);
    expect(sim.snapshot().alice).toBeNull();
  });

  it("walks on the legs it was drawn", () => {
    const sim = openAsSoul();
    incarnateFigure(sim);
    runSteps(sim, 30);
    const parked = aliceOf(sim).center.x;
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 60);
    expect(aliceOf(sim).center.x).toBeGreaterThan(parked + 20);
  });
});

describe("the fight", () => {
  const openTheTear = (sim: Simulation) => {
    sim.openTear();
    const tear = sim.snapshot().tear;
    if (tear === null) throw new Error("The page is whole");
    return tear;
  };

  it("tears the page above the heart and lets the servant through after a breath", () => {
    const sim = openAsSoul();
    const heart = incarnateFigure(sim);
    const tear = openTheTear(sim);
    expect(tear.phase).toBe("opening");
    expect(tear.at.y).toBeCloseTo(heart.y - TEAR_TUNING.aboveHeart, 0);
    const events = runUntil(sim, saw("servant-came"));
    expect(typesOf(events)).toContain("servant-came");
    expect(sim.snapshot().tear?.snippers.map((snipper) => snipper.rank)).toEqual(["servant"]);
  });

  it("hunts her alone: a twin standing in for her is not what the servant is after", () => {
    const sim = openAsSoul();
    const heart = incarnateFigure(sim);
    sim.setPhysics({ ...EARTH, clones: 1 });
    openTheTear(sim);
    sim.setWalkIntent(RIGHT, 1);
    runUntil(sim, saw("servant-came"));
    runSteps(sim, 30);
    const [her, twin] = sim.alices();
    if (her === undefined || twin === undefined) throw new Error("Two of her were expected");
    expect(twin.center.x).toBeGreaterThan(her.center.x + 20);
    const events = runUntil(sim, saw("snipped"));
    expect(typesOf(events)).toContain("snipped");
    expect(drawnLook(sim).body.strokes.length).toBeLessThan(6);
    expect(twin.look.kind).toBe("alice");
    expect(heart.y).toBeGreaterThan(sim.snapshot().tear?.at.y ?? Number.POSITIVE_INFINITY);
  });

  it("snips the legs first, and she can no longer walk until they are drawn back", () => {
    const sim = openAsSoul();
    incarnateFigure(sim);
    openTheTear(sim);
    const events = runUntil(sim, saw("snipped"));
    const snipped = events.find((event) => event.type === "snipped");
    expect(snipped).toEqual({ type: "snipped", part: "legs", lost: ["legs"] });
    expect(drawnLook(sim).abilities.walk).toBe(false);
    expect(drawnLook(sim).abilities.jump).toBe(false);
    expect(drawnLook(sim).body.strokes).toHaveLength(4);
    expect(sim.snapshot().tear?.mercy).toBe(true);

    const parked = aliceOf(sim).center.x;
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 60);
    expect(Math.abs(aliceOf(sim).center.x - parked)).toBeLessThan(3);

    expect(sim.graft(legsBelow(heartOf(sim)))).toBe(true);
    expect(typesOf(runSteps(sim, 1))).toContain("part-restored");
    expect(drawnLook(sim).abilities.walk).toBe(true);
    expect(drawnLook(sim).body.strokes).toHaveLength(6);
  });

  it("swallows a bare heart, and only the soul is left", () => {
    const sim = openAsSoul();
    const heart = soulOf(sim);
    sim.addDrawing(drawingOf("body", ringAround(heart, 14)));
    expect(sim.incarnate(idOf("body"), "me")).toBe(true);
    openTheTear(sim);
    const events = runUntil(sim, saw("heart-swallowed"));
    expect(typesOf(events).filter((type) => type !== "snip-missed")).toEqual([
      "servant-came",
      "snipped",
      "heart-swallowed",
    ]);
    expect(sim.snapshot().alice).toBeNull();
    expect(sim.snapshot().soul).not.toBeNull();
    expect(sim.snapshot().tear).toBeNull();
  });

  it("is hurt by a hazard it is baited over, until it perishes and the tear closes", () => {
    const sim = openAsSoul();
    const heart = incarnateFigure(sim);
    sim.addDrawing(drawingOf("lava", ringAround(heart, 260, 48)));
    sim.applyRuling(idOf("lava"), rulingOf("hazard"));
    openTheTear(sim);
    const events = runUntil(sim, saw("tear-closed"));
    const types = typesOf(events);
    expect(types).toContain("servant-struck");
    expect(types).toContain("servant-perished");
    expect(types).toContain("tear-closed");
    expect(sim.snapshot().tear).toBeNull();
    expect(sim.snapshot().alice).not.toBeNull();
  });
});
