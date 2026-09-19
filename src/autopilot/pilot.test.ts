import { describe, expect, it } from "vitest";
import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Rect, Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, walkSpeedAt } from "../sim/flight";
import { ALICE_BASE, type AliceSize, type AliceSnapshot } from "../sim/types";
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
  keyTaken: false,
  doorOpen: false,
  walkSpeed: walkSpeedAt(1),
  bounceArc: (strength) => bounceArcUnder(EARTH, strength),
  ...overrides,
});

describe("Pilot", () => {
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

  it("waits short of a gap it cannot cross and reports being stuck", () => {
    const pilot = createAutopilot();
    const goal: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };
    const near = scene({ board: board({ goal }), alice: alice({ x: 200, y: GROUND_Y }) });

    pilot.drive(near);

    expect(pilot.status.errand).toEqual({ kind: "wait", objective: "goal" });
    expect(pilot.status.stuck).toBe(true);
    expect(pilot.drive(near)).toEqual({ x: 0, y: 0 });
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
