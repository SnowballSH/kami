import { describe, expect, it } from "vitest";
import { blankBoard } from "../board/boards/blank";
import { EARTH } from "../rules/types";
import {
  blob,
  drawingOf,
  enter,
  feetOf,
  idOf,
  LEFT,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  STAY,
  typesOf,
} from "./testSupport";
import type { SimEvent } from "./types";

const board = blankBoard("meadow");
const GROUND = 0;
const DOOR = { width: 40, height: 90 } as const;

const warpsOf = (events: readonly SimEvent[]) =>
  events.flatMap((event) => (event.type === "warped" ? [event] : []));

const withPortals = (...xs: readonly number[]) => {
  const sim = enter(board);
  sim.setWalkIntent(STAY);
  xs.forEach((x, index) => {
    const name = `portal ${index + 1}`;
    sim.addDrawing(drawingOf(name, blob(x, GROUND, DOOR.width, DOOR.height)));
    sim.applyRuling(idOf(name), rulingOf("portal"));
  });
  runSteps(sim, 10);
  return sim;
};

const walkInto = (sim: ReturnType<typeof withPortals>, x: number) => {
  sim.setWalkIntent(x > feetOf(sim).x ? RIGHT : LEFT);
  const events = runUntil(sim, (seen) => seen.some((event) => event.type === "warped"), 600);
  sim.setWalkIntent(STAY);
  return events;
};

describe("portals", () => {
  it("send Alice out of the portal drawn after the one she stepped into", () => {
    const sim = withPortals(120, -240);
    const events = walkInto(sim, 120);
    expect(warpsOf(events)).toEqual([
      { type: "warped", who: 0, from: idOf("portal 1"), to: idOf("portal 2") },
    ]);
    expect(feetOf(sim).x).toBeCloseTo(-240, -1);
  });

  it("lead round in a ring: the last one lets out into the first", () => {
    const sim = withPortals(120, -300, -200);
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, (seen) => warpsOf(seen).length >= 2, 900);
    expect(warpsOf(events).map((event) => [event.from, event.to])).toEqual([
      [idOf("portal 1"), idOf("portal 2")],
      [idOf("portal 3"), idOf("portal 1")],
    ]);
  });

  it("do not throw her straight back through the one she came out of", () => {
    const sim = withPortals(120, -240);
    walkInto(sim, 120);
    const events = runSteps(sim, 120);
    expect(warpsOf(events)).toEqual([]);
    expect(Math.abs(feetOf(sim).x + 240)).toBeLessThan(DOOR.width);
  });

  it("let her use the exit again once she has stepped clear of it", () => {
    const sim = withPortals(120, -240);
    walkInto(sim, 120);
    sim.setWalkIntent(LEFT);
    runUntil(sim, (_, current) => feetOf(current).x < -240 - DOOR.width, 300);
    const events = walkInto(sim, -240);
    expect(warpsOf(events)).toEqual([
      { type: "warped", who: 0, from: idOf("portal 2"), to: idOf("portal 1") },
    ]);
  });

  it("go nowhere alone, and Kami says so once", () => {
    const sim = withPortals(120);
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 240);
    expect(warpsOf(events)).toEqual([]);
    expect(typesOf(events).filter((type) => type === "portal-lonely")).toHaveLength(1);
    expect(feetOf(sim).x).toBeGreaterThan(120 + DOOR.width);
  });

  it("are not walls: Alice passes through an unpaired one", () => {
    const sim = withPortals(120);
    sim.setWalkIntent(RIGHT);
    runUntil(sim, (_, current) => feetOf(current).x > 200, 600);
    expect(feetOf(sim).x).toBeGreaterThan(200);
  });

  it("carry only the Alice who stepped in, and say which one warped", () => {
    const sim = withPortals(200, -200);
    sim.setPhysics({ ...EARTH, clones: 1 });
    runSteps(sim, 30);
    const herself = feetOf(sim).x;
    sim.setWalkIntent(RIGHT, 1);
    const events = runUntil(sim, (seen) => warpsOf(seen).length > 0, 900);
    expect(warpsOf(events)).toEqual([
      { type: "warped", who: 1, from: idOf("portal 1"), to: idOf("portal 2") },
    ]);
    const twin = sim.aliceBounds(1);
    expect(twin.x + twin.width / 2).toBeCloseTo(-200, -1);
    expect(feetOf(sim).x).toBeCloseTo(herself, 0);
  });
});
