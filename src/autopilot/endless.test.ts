import { describe, expect, it } from "vitest";
import { ENDLESS_GROUND, endlessBoard } from "../board/boards/endless";
import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "../sim/flight";
import { ALICE_BASE, type AliceSnapshot } from "../sim/types";
import { CELL_PX, Chart, WINDOW_PX } from "./chart";
import { createAutopilot } from "./index";
import type { Scene, SceneInk } from "./types";

const page = endlessBoard("together");
const groundEnd = ENDLESS_GROUND.x + ENDLESS_GROUND.width;

const alice = (feet: Vec, facing: 1 | -1 = 1): AliceSnapshot => ({
  center: { x: feet.x, y: feet.y - ALICE_BASE.height / 2 },
  width: ALICE_BASE.width,
  height: ALICE_BASE.height,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
});

const line = (from: Vec, to: Vec, spacing = 4): Vec[] => {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

const ink = (id: string, points: readonly Vec[]): SceneInk => ({
  drawing: { id: id as DrawingId, strokes: [points], cost: 0 },
  pose: { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
  nature: "ink",
  strength: 1,
});

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  board: page,
  alice: alice({ x: 0, y: ENDLESS_GROUND.y }),
  others: [],
  inks: [],
  bites: [],
  sumikui: null,
  keyTaken: false,
  doorOpen: false,
  walkSpeed: walkSpeedAt(1),
  canFly: false,
  bounceArc: (strength) => bounceArcUnder(EARTH, strength),
  jumpArc: jumpArcUnder(EARTH, 1),
  ...overrides,
});

const LEDGE_TOP = ENDLESS_GROUND.y - 60;
const leftLedge = ink("left", line({ x: -340, y: LEDGE_TOP }, { x: -260, y: LEDGE_TOP }));
const rightLedge = ink("right", line({ x: 260, y: LEDGE_TOP }, { x: 340, y: LEDGE_TOP }));
const farAway = ink("far", line({ x: 1e9, y: 100 }, { x: 1e9 + 20, y: 100 }));

describe("charting an endless page", () => {
  it("reads a fixed window of paper around Alice wherever she is, whatever else is drawn", () => {
    const feet = { x: 1_000_000, y: -500_000 };
    const chart = Chart.of(scene({ alice: alice(feet), inks: [farAway, leftLedge] }));
    expect(chart).not.toBeNull();
    const { c0, c1, r0, r1 } = chart?.range ?? { c0: 0, c1: 0, r0: 0, r1: 0 };
    expect((c1 - c0) * CELL_PX).toBeCloseTo(2 * WINDOW_PX.x, -2);
    expect((r1 - r0) * CELL_PX).toBeCloseTo(2 * WINDOW_PX.y, -2);
    expect(((c0 + c1) / 2) * CELL_PX).toBeCloseTo(feet.x, -1);
    expect(((r0 + r1) / 2) * CELL_PX).toBeCloseTo(feet.y - ALICE_BASE.height / 2, -1);
  });

  it("still knows the ground under her, and the ink inside the window", () => {
    const chart = Chart.of(scene({ inks: [rightLedge, farAway] }));
    const groundRow = Math.floor((ENDLESS_GROUND.y + 1) / CELL_PX);
    expect(chart?.has(0, groundRow, 1)).toBe(true);
    expect(chart?.has(Math.floor(300 / CELL_PX), Math.floor(LEDGE_TOP / CELL_PX), 1)).toBe(true);
    expect(chart?.has(Math.floor(-2000 / CELL_PX), groundRow, 1)).toBe(false);
  });
});

describe("exploring an endless page", () => {
  it("walks towards the newest ink, whichever side it is on", () => {
    const toTheRight = createAutopilot();
    expect(toTheRight.drive(scene({ inks: [leftLedge, rightLedge] })).x).toBe(1);
    expect(toTheRight.status.errand).toEqual({
      kind: "explore",
      toward: { x: 300, y: LEDGE_TOP },
    });
    expect(toTheRight.status.stuck).toBe(false);

    const toTheLeft = createAutopilot();
    expect(toTheLeft.drive(scene({ inks: [rightLedge, leftLedge] })).x).toBe(-1);
    expect(toTheLeft.status.errand).toMatchObject({ kind: "explore", toward: { x: -300 } });
  });

  it("with nothing drawn, walks to the edge of the ground she faces and stops short of it", () => {
    const pilot = createAutopilot();
    expect(pilot.drive(scene({ alice: alice({ x: 0, y: ENDLESS_GROUND.y }, -1) })).x).toBe(-1);
    expect(pilot.status.errand).toEqual({
      kind: "explore",
      toward: { x: -WINDOW_PX.x, y: ENDLESS_GROUND.y },
    });
    const target = pilot.status.target;
    expect(target?.x).toBeLessThan(-100);
    expect(target?.x).toBeGreaterThan(ENDLESS_GROUND.x + 60);
    expect(target?.x).toBeLessThan(groundEnd);
  });

  it("goes after a goal someone names, as in any room", () => {
    const pilot = createAutopilot();
    pilot.drive(scene({ inks: [{ ...rightLedge, nature: "goal" }] }));
    expect(pilot.status.errand).toMatchObject({ objective: "goal" });
  });
});
