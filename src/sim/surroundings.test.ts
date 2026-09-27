import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import type { BoardDefinition } from "../board/types";
import { EARTH } from "../rules/types";
import { buildWorld } from "./boardWorld";
import type { Feelers } from "./creatures";
import { LiveSurroundings } from "./surroundings";
import { drawingOf, idOf, line, rulingOf, STAY } from "./testSupport";

const FLOORLESS: BoardDefinition = {
  id: "floorless",
  title: "",
  spawn: { x: 0, y: 0 },
  killY: Number.POSITIVE_INFINITY,
  solids: [],
  zones: [],
  noInkZones: [],
};

const NO_FEELERS: Feelers = { touches: () => [], groundBelow: () => false };

const setup = () => {
  const world = buildWorld(FLOORLESS, EARTH);
  return { world, surroundings: new LiveSurroundings(world, NO_FEELERS) };
};

const plank = () => drawingOf("plank", line({ x: -150, y: 200 }, { x: 150, y: 200 }));

describe("LiveSurroundings", () => {
  it("keeps the joined obstacle list until the board changes it", () => {
    const { world, surroundings } = setup();
    world.inks.add(plank());
    const before = surroundings.obstacles;
    expect(surroundings.obstacles).toBe(before);

    world.inks.applyRuling(idOf("plank"), rulingOf("climbable"));
    expect(surroundings.obstacles).not.toBe(before);
    expect(surroundings.obstacles).toHaveLength(0);
    expect(surroundings.passables).toHaveLength(1);
  });

  it("lets Alice sense ink that came or went after the surroundings were taken", () => {
    const { world, surroundings } = setup();
    const { alice, inks } = world;
    inks.add(plank());
    const [ink] = inks.all;
    if (ink === undefined) throw new Error("the plank was not built");
    const feet = alice.bounds().y + alice.bounds().height;
    Matter.Body.translate(alice.body, { x: 0, y: ink.body.bounds.min.y - feet - 1 });

    alice.sense(surroundings, STAY);
    expect(alice.grounded).toBe(true);

    inks.remove(ink.id);
    alice.sense(surroundings, STAY);
    expect(alice.grounded).toBe(false);
  });
});
