import { describe, expect, it } from "vitest";
import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Rect, Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "../sim/flight";
import { ALICE_BASE, type AliceSize, type AliceSnapshot } from "../sim/types";
import { CELL_PX, CellFlag, Chart } from "./chart";
import { createAutopilot } from "./index";
import type { Scene, SceneInk } from "./types";

const GROUND_Y = 400;
const GAP: Rect = { x: 300, y: GROUND_Y, width: 200, height: 40 };

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
  ...overrides,
});

const alice = (feet: Vec, size: AliceSize = "normal"): AliceSnapshot => {
  const scale = size === "big" ? 2 : size === "small" ? 0.5 : 1;
  const height = ALICE_BASE.height * scale;
  return {
    center: { x: feet.x, y: feet.y - height / 2 },
    width: ALICE_BASE.width * scale,
    height,
    size,
    facing: 1,
    walking: false,
    grounded: true,
    climbing: false,
    hasKey: false,
  };
};

let nextId = 0;
const ink = (points: readonly Vec[], nature: Nature = "ink", strength = 1): SceneInk => ({
  drawing: {
    id: `drawing-${nextId++}` as DrawingId,
    strokes: [points],
    cost: 0,
  },
  pose: { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0 },
  nature,
  strength,
});

const line = (from: Vec, to: Vec, spacing = 4): Vec[] => {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / count,
    y: from.y + ((to.y - from.y) * i) / count,
  }));
};

const scene = (overrides: Partial<Scene> = {}): Scene => ({
  board: board(),
  alice: alice({ x: 100, y: GROUND_Y }),
  inks: [],
  bites: [],
  keyTaken: false,
  doorOpen: false,
  walkSpeed: walkSpeedAt(1),
  canFly: false,
  bounceArc: (strength) => bounceArcUnder(EARTH, strength),
  jumpArc: jumpArcUnder(EARTH, 1),
  ...overrides,
});

describe("Pilot", () => {
  it("charts a bite through an off-grid slab without leaving phantom ground", () => {
    const floor = { x: 0, y: GROUND_Y + 1, width: 300, height: 10 };
    const hole = { x: 120, y: floor.y, width: 48, height: floor.height };
    const bitten = scene({ board: board({ solids: [solid(floor)] }), bites: [hole] });
    const chart = Chart.of(bitten);
    const column = Math.floor(140 / CELL_PX);
    for (
      let row = Math.floor(floor.y / CELL_PX);
      row < Math.ceil((floor.y + floor.height) / CELL_PX);
      row++
    ) {
      expect(chart.has(column, row, CellFlag.solid)).toBe(false);
      expect(chart.has(column, row, CellFlag.fixture)).toBe(false);
      expect(chart.has(Math.floor(80 / CELL_PX), row, CellFlag.solid)).toBe(true);
    }
    const healed = Chart.of({ ...bitten, bites: [] });
    expect(healed.has(column, Math.floor(floor.y / CELL_PX), CellFlag.solid)).toBe(true);
    const bridged = Chart.of({
      ...bitten,
      inks: [ink(line({ x: 110, y: floor.y }, { x: 180, y: floor.y }))],
    });
    expect(bridged.has(column, Math.floor(floor.y / CELL_PX), CellFlag.solid)).toBe(true);
  });

  it("idles on a board with nothing to go for", () => {
    const pilot = createAutopilot();

    expect(pilot.drive(scene())).toEqual({ x: 0, y: 0 });
    expect(pilot.status.errand).toEqual({ kind: "idle" });
    expect(pilot.status.stuck).toBe(false);
  });

  it("walks toward a goal it can reach", () => {
    const pilot = createAutopilot();
    const goal: Rect = { x: 200, y: GROUND_Y - 60, width: 40, height: 60 };

    const intent = pilot.drive(scene({ board: board({ goal }) }));

    expect(intent.x).toBe(1);
    expect(pilot.status).toMatchObject({
      errand: { kind: "objective", objective: "goal" },
      stuck: false,
    });
  });

  it("charts a creature pressed against Alice as air, but ink in the same place as a wall", () => {
    const over = (nature: Nature): SceneInk =>
      ink(line({ x: 90, y: GROUND_Y - 30 }, { x: 110, y: GROUND_Y - 30 }), nature);
    const cellThroughHer = {
      c: Math.floor(100 / CELL_PX),
      r: Math.floor((GROUND_Y - 30) / CELL_PX),
    };

    const creature = Chart.of(scene({ inks: [over("walker")] }));
    const plain = Chart.of(scene({ inks: [over("ink")] }));
    expect(creature.has(cellThroughHer.c, cellThroughHer.r, CellFlag.solid)).toBe(false);
    expect(plain.has(cellThroughHer.c, cellThroughHer.r, CellFlag.solid)).toBe(true);

    const beside = Chart.of(
      scene({
        inks: [ink(line({ x: 150, y: GROUND_Y - 30 }, { x: 170, y: GROUND_Y - 30 }), "walker")],
      }),
    );
    expect(beside.has(Math.floor(160 / CELL_PX), cellThroughHer.r, CellFlag.solid)).toBe(true);
  });

  it("waits short of a gap it cannot cross and reports being stuck", () => {
    const pilot = createAutopilot();
    const goal: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };
    const near = scene({ board: board({ goal }), alice: alice({ x: 200, y: GROUND_Y }) });

    pilot.drive(near);

    expect(pilot.status.errand).toEqual({ kind: "wait", objective: "goal" });
    expect(pilot.status.stuck).toBe(true);
    expect(pilot.drive(near)).toEqual({ x: 0, y: 0 });
  });

  it("flies over the gap under a flight law, with nothing drawn", () => {
    const pilot = createAutopilot();
    const goal: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };
    const intent = pilot.drive(scene({ board: board({ goal }), canFly: true }));

    expect(intent.x).toBe(1);
    expect(pilot.status).toMatchObject({
      errand: { kind: "objective", objective: "goal" },
      stuck: false,
    });
  });

  it("crosses the gap once a drawn bridge is committed", () => {
    const pilot = createAutopilot();
    const goal: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };
    const bridge = ink(
      line({ x: GAP.x - 20, y: GROUND_Y - 4 }, { x: GAP.x + GAP.width + 20, y: GROUND_Y - 4 }),
    );
    const withBridge = scene({ board: board({ goal }), inks: [bridge] });

    pilot.drive(scene({ board: board({ goal }) }));
    pilot.invalidate();
    const intent = pilot.drive(withBridge);

    expect(intent.x).toBe(1);
    expect(pilot.status).toMatchObject({
      errand: { kind: "objective", objective: "goal" },
      stuck: false,
    });
  });

  it("jumps a ditch too wide to step but short enough to clear", () => {
    const pilot = createAutopilot();
    const ditch = 64;
    const goal: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };
    const board_ = board({
      goal,
      solids: [
        solid({ x: 0, y: GROUND_Y, width: GAP.x, height: 40 }),
        solid({ x: GAP.x + ditch, y: GROUND_Y, width: 500, height: 40 }),
      ],
    });
    let feet: Vec = { x: GAP.x - 40, y: GROUND_Y };
    let intent = pilot.drive(scene({ board: board_, alice: alice(feet) }));
    expect(pilot.status).toMatchObject({
      errand: { kind: "objective", objective: "goal" },
      stuck: false,
    });

    for (let tick = 0; tick < 40 && intent.y === 0; tick++) {
      expect(intent.x).toBe(1);
      feet = { x: feet.x + walkSpeedAt(1), y: GROUND_Y };
      intent = pilot.drive(scene({ board: board_, alice: alice(feet) }));
    }

    expect(intent).toEqual({ x: 1, y: -1 });
    expect(feet.x).toBeGreaterThan(GAP.x - ALICE_BASE.width);
    expect(feet.x).toBeLessThan(GAP.x + ALICE_BASE.width / 2);
  });

  it("jumps up onto a ledge too tall to step onto", () => {
    const pilot = createAutopilot();
    const ledgeTop = GROUND_Y - 56;
    const goal: Rect = { x: 700, y: ledgeTop - 60, width: 40, height: 60 };
    const stepped = board({
      goal,
      solids: [
        solid({ x: 0, y: GROUND_Y, width: 400, height: 40 }),
        solid({ x: 400, y: ledgeTop, width: 500, height: 96 }),
      ],
    });

    pilot.drive(scene({ board: stepped, alice: alice({ x: 380, y: GROUND_Y }) }));

    expect(pilot.status).toMatchObject({
      errand: { kind: "objective", objective: "goal" },
      stuck: false,
    });
  });

  it("prefers the key, then the door, then the goal", () => {
    const pilot = createAutopilot();
    const flat = board({
      solids: [solid({ x: 0, y: GROUND_Y, width: 1000, height: 40 })],
      key: { x: 300, y: GROUND_Y - 30 },
      door: { x: 500, y: GROUND_Y - 80, width: 20, height: 80 },
      goal: { x: 800, y: GROUND_Y - 60, width: 40, height: 60 },
    });

    pilot.drive(scene({ board: flat }));
    expect(pilot.status.errand).toEqual({ kind: "objective", objective: "key" });

    pilot.drive(scene({ board: flat, keyTaken: true }));
    expect(pilot.status.errand).toEqual({ kind: "objective", objective: "door" });

    pilot.drive(scene({ board: flat, keyTaken: true, doorOpen: true }));
    expect(pilot.status.errand).toEqual({ kind: "objective", objective: "goal" });
  });

  it("goes to eat a cake when only a bigger Alice can reach the key", () => {
    const pilot = createAutopilot();
    const flat = board({
      solids: [solid({ x: 0, y: GROUND_Y, width: 1000, height: 40 })],
      key: { x: 600, y: GROUND_Y - 130 },
    });
    const cake = ink(line({ x: 380, y: GROUND_Y - 12 }, { x: 420, y: GROUND_Y - 12 }), "grow");

    pilot.drive(scene({ board: flat, inks: [cake] }));

    expect(pilot.status.errand).toEqual({ kind: "eat", drawingId: cake.drawing.id });
  });
});
