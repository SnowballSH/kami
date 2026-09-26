import { describe, expect, it } from "vitest";
import { ENDLESS_STRIP as ENDLESS_GROUND, endlessPage } from "../board/boards/endless";
import { EARTH } from "../rules/types";
import { FALL_LIMIT, Footings, LastFooting } from "./footing";
import {
  aliceOf,
  drawingOf,
  enter,
  feetOf,
  happeningsOf,
  idOf,
  line,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  STAY,
  saw,
} from "./testSupport";

const page = endlessPage("together", [ENDLESS_GROUND]);
const groundEnd = ENDLESS_GROUND.x + ENDLESS_GROUND.width;
const LEDGE_TOP = 300;
const ledge = drawingOf(
  "ledge",
  line({ x: groundEnd - 5, y: 20 }, { x: groundEnd - 5, y: LEDGE_TOP }),
  line({ x: groundEnd - 5, y: LEDGE_TOP }, { x: 900, y: LEDGE_TOP }),
);

describe("an endless page", () => {
  it("stands Alice on the strip of ground, which has no edge to hit and no bottom to reach", () => {
    const sim = enter(page);
    expect(runSteps(sim, 30)).toEqual([]);
    expect(aliceOf(sim).grounded).toBe(true);
    expect(feetOf(sim).y).toBeCloseTo(ENDLESS_GROUND.y, 0);
    expect(page.killY).toBe(Number.POSITIVE_INFINITY);
  });

  it("puts her back where she last stood when she walks off the ground, not on the spawn", () => {
    const sim = enter(page);
    sim.setWalkIntent(RIGHT);
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeGreaterThan(groundEnd - 60);
    expect(feetOf(sim).x).toBeLessThan(groundEnd + 20);
    expect(feetOf(sim).y).toBeCloseTo(ENDLESS_GROUND.y, -1);
  });

  it("puts her back on the last ink she stood on, and only on the spawn once that ink is gone", () => {
    const sim = enter(page);
    sim.addDrawing(ledge);
    sim.applyRuling(idOf("ledge"), rulingOf("sticky"));
    sim.setWalkIntent(RIGHT);
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeGreaterThan(700);
    expect(feetOf(sim).y).toBeCloseTo(LEDGE_TOP, -1);
    sim.setWalkIntent(STAY);
    runSteps(sim, 30);
    expect(aliceOf(sim).grounded).toBe(true);

    sim.removeDrawing(idOf("ledge"));
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeGreaterThan(700);
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(page.spawn.x, 0);
    expect(feetOf(sim).y).toBeCloseTo(page.spawn.y, -1);
  });
});

describe("twins on an endless page", () => {
  const STEP_DROP = 600;
  const firstStep = { x: groundEnd - 50, y: ENDLESS_GROUND.y + STEP_DROP, width: 550, height: 36 };
  const secondStep = { x: 850, y: firstStep.y + STEP_DROP, width: 550, height: 36 };
  const wall = { x: 1400, y: secondStep.y - 200, width: 36, height: 236 };
  const stairs = endlessPage("stairs", [ENDLESS_GROUND, firstStep, secondStep, wall]);

  it("judges a twin's fall from where she last stood, not from where Alice stands", () => {
    const sim = enter(stairs);
    sim.setPhysics({ ...EARTH, clones: 1 });
    sim.setWalkIntent(STAY);
    sim.setWalkIntent(RIGHT, 1);
    const events = runSteps(sim, 900);
    expect(events.filter((event) => event.type === "fell")).toEqual([]);
    const [twin] = sim.snapshot().twins;
    expect(twin?.grounded).toBe(true);
    expect(twin?.center.y).toBeGreaterThan(firstStep.y);
  });
});

describe("the last footing", () => {
  it("counts a fall from where she last stood, or from the spawn before she has stood anywhere", () => {
    const footing = new LastFooting({ x: 0, y: 0 });
    expect(footing.fallen({ x: 0, y: FALL_LIMIT - 1 })).toBe(false);
    expect(footing.fallen({ x: 0, y: FALL_LIMIT + 1 })).toBe(true);
    footing.stood({ x: 5000, y: -3000 });
    expect(footing.fallen({ x: 5000, y: 0 })).toBe(true);
    expect(footing.fallen({ x: 5000, y: -3000 + FALL_LIMIT - 1 })).toBe(false);
  });

  it("keeps one footing per Alice, a newcomer's copied from Alice's, a dismissed twin's forgotten", () => {
    const footings = new Footings({ x: 0, y: 0 });
    footings.of(0).stood({ x: 10, y: 20 });
    expect(footings.of(2).respawn()).toEqual({ x: 10, y: 20 });
    footings.of(1).stood({ x: 50, y: 900 });
    expect(footings.of(1).fallen({ x: 50, y: 900 + FALL_LIMIT - 1 })).toBe(false);
    expect(footings.of(0).fallen({ x: 10, y: 900 })).toBe(false);
    footings.of(0).stood({ x: 70, y: 80 });
    footings.keep(1);
    expect(footings.of(1).respawn()).toEqual({ x: 70, y: 80 });
    expect(footings.of(0).respawn()).toEqual({ x: 70, y: 80 });
  });

  it("returns her to the footing once, then to the spawn until she stands again", () => {
    const footing = new LastFooting({ x: 0, y: 0 });
    expect(footing.respawn()).toEqual({ x: 0, y: 0 });
    footing.stood({ x: 10, y: 20 });
    expect(footing.respawn()).toEqual({ x: 10, y: 20 });
    expect(footing.respawn()).toEqual({ x: 0, y: 0 });
    footing.stood({ x: 10, y: 20 });
    footing.stood({ x: 30, y: 40 });
    expect(footing.respawn()).toEqual({ x: 30, y: 40 });
    footing.stood({ x: 30, y: 40 });
    expect(footing.respawn()).toEqual({ x: 30, y: 40 });
  });
});
