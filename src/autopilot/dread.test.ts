import { describe, expect, it } from "vitest";
import type { BoardDefinition } from "../board/types";
import type { Rect, Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "../sim/flight";
import {
  ALICE_BASE,
  type AliceSnapshot,
  type SumikuiPhase,
  type SumikuiQuarry,
  type SumikuiSnapshot,
} from "../sim/types";
import { DREAD_PX, dreadIn, SAFE_PX } from "./dread";
import { createAutopilot } from "./index";
import type { Scene, SceneInk } from "./types";

const GROUND_Y = 400;
const GAP: Rect = { x: 300, y: GROUND_Y, width: 200, height: 40 };
const GOAL: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };

const solid = (rect: Rect) => ({ rect, material: "marker" as const });

const board = (overrides: Partial<BoardDefinition> = {}): BoardDefinition => ({
  id: "test",
  title: "Test",
  spawn: { x: 100, y: GROUND_Y },
  killY: 1000,
  solids: [
    solid({ x: 0, y: GROUND_Y, width: GAP.x, height: 40 }),
    solid({ x: GAP.x + GAP.width, y: GROUND_Y, width: 500, height: 40 }),
  ],
  zones: [],
  noInkZones: [],
  goal: GOAL,
  ...overrides,
});

const alice = (feet: Vec): AliceSnapshot => ({
  center: { x: feet.x, y: feet.y - ALICE_BASE.height / 2 },
  velocity: { x: 0, y: 0 },
  width: ALICE_BASE.width,
  height: ALICE_BASE.height,
  size: "normal",
  sizeMultiplier: 1,
  headingScale: 1,
  facing: 1,
  walking: false,
  grounded: true,
  climbing: false,
  hasKey: false,
  ride: null,
});

const sumikui = (
  centre: Vec,
  phase: SumikuiPhase,
  quarry: SumikuiQuarry | null,
  chewing: DrawingId | null = null,
): SumikuiSnapshot => ({
  centre,
  facing: 1,
  phase,
  quarry,
  prey: quarry === "alice" ? 0 : null,
  chewing,
  bite: 0,
  awakeMs: 30_000,
});

const bridge = (id: string): SceneInk => ({
  drawing: {
    id: id as DrawingId,
    strokes: [
      [
        { x: GAP.x - 20, y: GROUND_Y - 4 },
        { x: GAP.x + GAP.width + 20, y: GROUND_Y - 4 },
      ],
    ],
    cost: 0,
  },
  pose: { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
  nature: "ink",
  strength: 1,
});

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  board: board(),
  alice: alice({ x: 200, y: GROUND_Y }),
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

const feet: Vec = { x: 200, y: GROUND_Y };
const behindHer: Vec = { x: 150, y: GROUND_Y - 40 };
const farBehindHer: Vec = { x: 200 - DREAD_PX - 50, y: GROUND_Y - 40 };

describe("dreadIn", () => {
  it("is nothing while the Sumikui is absent, stirring, sated or far away", () => {
    expect(dreadIn(scene())).toBeNull();
    expect(dreadIn(scene({ sumikui: sumikui(behindHer, "stirring", null) }))).toBeNull();
    expect(dreadIn(scene({ sumikui: sumikui(behindHer, "sated", null) }))).toBeNull();
    expect(dreadIn(scene({ sumikui: sumikui(farBehindHer, "hunting", "alice") }))).toBeNull();
  });

  it("is nothing while it hunts ink she is not standing on", () => {
    expect(dreadIn(scene({ sumikui: sumikui(behindHer, "hunting", "ink") }))).toBeNull();
    expect(dreadIn(scene({ sumikui: sumikui(behindHer, "feeding", "ink") }))).toBeNull();
  });

  it("is the Sumikui itself when it is close and after her or the ground under her", () => {
    expect(dreadIn(scene({ sumikui: sumikui(behindHer, "hunting", "alice") }))).toEqual(behindHer);
    expect(dreadIn(scene({ sumikui: sumikui(behindHer, "feeding", "paper") }))).toEqual(behindHer);
  });
});

describe("Pilot under the Sumikui", () => {
  it("goes about the goal while the Sumikui merely prowls", () => {
    const pilot = createAutopilot();
    const prowling = scene({
      inks: [bridge("bridge")],
      sumikui: sumikui(behindHer, "stirring", null),
    });

    expect(pilot.drive(prowling).x).toBe(1);
    expect(pilot.status.errand).toEqual({ kind: "objective", objective: "goal" });
  });

  it("runs from a Sumikui lunging at her to the far edge of the ledge, and looks to the player", () => {
    const pilot = createAutopilot();
    const hunted = scene({ sumikui: sumikui(behindHer, "hunting", "alice") });

    const intent = pilot.drive(hunted);

    expect(pilot.status.errand).toEqual({ kind: "flee" });
    expect(intent.x).toBe(1);
    expect(pilot.status.stuck).toBe(true);
    const { target } = pilot.status;
    if (target === null) throw new Error("no refuge chosen");
    expect(target.x).toBeGreaterThan(feet.x);
  });

  it("runs the other way when the Sumikui comes from ahead", () => {
    const pilot = createAutopilot();
    const ahead: Vec = { x: 260, y: GROUND_Y - 40 };
    const hunted = scene({ sumikui: sumikui(ahead, "hunting", "alice") });

    const intent = pilot.drive(hunted);

    expect(pilot.status.errand).toEqual({ kind: "flee" });
    expect(intent.x).toBe(-1);
  });

  it("would rather cross a bridge to safety than be cornered on a ledge", () => {
    const pilot = createAutopilot();
    const cornered = scene({
      inks: [bridge("bridge")],
      sumikui: sumikui(behindHer, "hunting", "alice"),
    });

    pilot.drive(cornered);

    const { target } = pilot.status;
    if (target === null) throw new Error("no refuge chosen");
    expect(target.x).toBeGreaterThan(GAP.x);
    expect(target.x - behindHer.x).toBeGreaterThanOrEqual(SAFE_PX);
    expect(pilot.status.stuck).toBe(false);
  });

  it("reports being cornered when there is no footing out of its reach", () => {
    const pilot = createAutopilot();
    const island = board({
      solids: [solid({ x: 150, y: GROUND_Y, width: 100, height: 40 })],
    });
    const above: Vec = { x: 200, y: GROUND_Y - 120 };
    const cornered = scene({ board: island, sumikui: sumikui(above, "hunting", "alice") });

    pilot.drive(cornered);

    expect(pilot.status.errand).toEqual({ kind: "flee" });
    expect(pilot.status.stuck).toBe(true);
  });

  it("drops the flight and returns to the goal the moment it loses interest in her", () => {
    const pilot = createAutopilot();
    const inks = [bridge("bridge")];
    pilot.drive(scene({ inks, sumikui: sumikui(behindHer, "hunting", "alice") }));
    expect(pilot.status.errand).toEqual({ kind: "flee" });

    pilot.drive(scene({ inks, sumikui: sumikui(behindHer, "sated", null) }));

    expect(pilot.status.errand).toEqual({ kind: "objective", objective: "goal" });
  });

  it("does not count on a bridge the Sumikui is chewing, and waits for the player instead", () => {
    const pilot = createAutopilot();
    const farAway: Vec = { x: 900, y: 100 };
    const chewed = scene({
      inks: [bridge("bridge")],
      sumikui: sumikui(farAway, "feeding", "ink", "bridge" as DrawingId),
    });

    pilot.drive(chewed);

    expect(pilot.status.errand).toEqual({ kind: "wait", objective: "goal" });
  });

  it("races across the chewed bridge when it is the only way and she is already on it", () => {
    const pilot = createAutopilot();
    const midBridge = alice({ x: GAP.x + 60, y: GROUND_Y - 4 });
    const farAway: Vec = { x: 900, y: 100 };
    const chewed = scene({
      alice: { ...midBridge, grounded: true },
      board: board({ killY: 420 }),
      inks: [bridge("bridge")],
      sumikui: sumikui(farAway, "feeding", "ink", "bridge" as DrawingId),
    });

    const intent = pilot.drive(chewed);

    expect(pilot.status.errand).toEqual({ kind: "objective", objective: "goal" });
    expect(intent.x).toBe(1);
  });
});
