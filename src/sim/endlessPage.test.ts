import { describe, expect, it } from "vitest";
import { ENDLESS_GROUND, endlessBoard } from "../board/boards/endless";
import { FALL_LIMIT, LastFooting } from "./footing";
import {
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

const page = endlessBoard("together");
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
    expect(sim.snapshot().alice.grounded).toBe(true);
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
    expect(sim.snapshot().alice.grounded).toBe(true);

    sim.removeDrawing(idOf("ledge"));
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeGreaterThan(700);
    expect(happeningsOf(runUntil(sim, saw("fell")))).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(page.spawn.x, 0);
    expect(feetOf(sim).y).toBeCloseTo(page.spawn.y, -1);
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
