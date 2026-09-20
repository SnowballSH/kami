import { describe, expect, it } from "vitest";
import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Rect, Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "../sim/flight";
import { aliceOf, enter, runSteps } from "../sim/testSupport";
import { ALICE_BASE, type AliceSize, type AliceSnapshot } from "../sim/types";
import { CELL_PX, CellFlag, Chart, MAX_CHART_CELLS } from "./chart";
import { createAutopilot } from "./index";
import { footprintFor, nodeOfFeet, Pathfinder } from "./pathfinder";
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

const alice = (feet: Vec, size: AliceSize = "normal", sizeMultiplier = 1): AliceSnapshot => {
  const scale = (size === "big" ? 2 : size === "small" ? 0.5 : 1) * sizeMultiplier;
  const height = ALICE_BASE.height * scale;
  return {
    center: { x: feet.x, y: feet.y - height / 2 },
    velocity: { x: 0, y: 0 },
    width: ALICE_BASE.width * scale,
    height,
    size,
    sizeMultiplier,
    headingScale: scale,
    facing: 1,
    walking: false,
    grounded: true,
    climbing: false,
    hasKey: false,
    look: { kind: "alice" },
    ride: null,
  };
};

let nextId = 0;
const ink = (points: readonly Vec[], nature: Nature = "ink", strength = 1): SceneInk => ({
  drawing: {
    id: `drawing-${nextId++}` as DrawingId,
    strokes: [points],
    cost: 0,
  },
  pose: { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
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

describe("Pilot", () => {
  it("charts a bite through an off-grid slab without leaving phantom ground", () => {
    const floor = { x: 0, y: GROUND_Y + 1, width: 300, height: 10 };
    const hole = { x: 120, y: floor.y, width: 48, height: floor.height };
    const bitten = scene({ board: board({ solids: [solid(floor)] }), bites: [hole] });
    const chart = Chart.of(bitten);
    if (chart === null) throw new Error("bitten chart refused");
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
    expect(healed?.has(column, Math.floor(floor.y / CELL_PX), CellFlag.solid)).toBe(true);
    const bridged = Chart.of({
      ...bitten,
      inks: [ink(line({ x: 110, y: floor.y }, { x: 180, y: floor.y }))],
    });
    expect(bridged?.has(column, Math.floor(floor.y / CELL_PX), CellFlag.solid)).toBe(true);
  });

  it("waits safely on an oversized world without modifying the artwork", () => {
    const drawing = ink(
      [
        { x: 1e9, y: 100 },
        { x: 1e9 + 20, y: 100 },
      ],
      "goal",
    );
    const original = structuredClone(drawing);
    const distant = scene({ inks: [drawing] });
    expect(Chart.of(distant)).toBeNull();
    const pilot = createAutopilot();
    expect(pilot.drive(distant)).toEqual({ x: 0, y: 0 });
    expect(pilot.status).toMatchObject({ errand: { kind: "wait" }, stuck: true, target: null });
    expect(drawing).toEqual(original);
  });

  it("rejects long airborne excursions and oversized or unsafe chart dimensions", () => {
    expect(Chart.of(scene({ alice: alice({ x: 100, y: -1e8 }), canFly: true }))).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({ solids: [solid({ x: 0, y: 400, width: 1e8, height: 40 })] }),
        }),
      ),
    ).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({
            solids: [solid({ x: 0, y: 0, width: 10000, height: 10000 })],
            killY: 20000,
          }),
        }),
      ),
    ).toBeNull();
    expect(Chart.of(scene({ alice: alice({ x: Number.POSITIVE_INFINITY, y: 400 }) }))).toBeNull();
  });

  it("bounds input geometry and repeated segment stamping independently of cell allocation", () => {
    const dense = ink(Array.from({ length: 50_001 }, () => ({ x: 100, y: 100 })));
    expect(Chart.of(scene({ inks: [dense] }))).toBeNull();
    const repeated = ink(Array.from({ length: 5000 }, (_, i) => ({ x: i % 2 ? 0 : 2000, y: 380 })));
    expect(Chart.of(scene({ inks: [repeated] }))).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({ solids: [solid({ x: 0, y: 400, width: 1000, height: 1e9 })] }),
        }),
      ),
    ).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({ solids: [solid({ x: 0, y: 400, width: 0, height: 1e9 })] }),
        }),
      ),
    ).toBeNull();
  });

  it("preserves normal chart geometry within the allocation limit", () => {
    const chart = Chart.of(scene({ inks: [ink([{ x: 600, y: 200 }], "hazard")] }));
    if (chart === null) throw new Error("ordinary chart refused");
    const { c0, c1, r0, r1 } = chart.range;
    expect((c1 - c0) * (r1 - r0)).toBeLessThanOrEqual(MAX_CHART_CELLS);
    expect(chart.has(600 / CELL_PX, 200 / CELL_PX, CellFlag.hazard)).toBe(true);
    expect(chart.has(Math.floor(100 / CELL_PX), GROUND_Y / CELL_PX, CellFlag.fixture)).toBe(true);
  });

  it("routes across a compact scene at large absolute coordinates without key aliasing", () => {
    const offset = 1e12;
    const ground = GROUND_Y + offset;
    const pilot = createAutopilot();
    const far = scene({
      alice: alice({ x: offset + 100, y: ground }),
      board: board({
        spawn: { x: offset + 100, y: ground },
        solids: [solid({ x: offset, y: ground, width: 1000, height: 40 })],
        goal: { x: offset + 600, y: ground - 60, width: 40, height: 60 },
        killY: ground + 1000,
      }),
    });
    expect(pilot.drive(far).x).toBe(1);
    expect(pilot.status.errand.kind).toBe("objective");
    expect(pilot.status.stuck).toBe(false);
  });

  it("replans a low passage when a law enlarges Alice without changing her size state", () => {
    const pilot = createAutopilot();
    const passage = board({
      solids: [
        solid({ x: 0, y: GROUND_Y, width: 1000, height: 40 }),
        solid({ x: 200, y: 0, width: 200, height: GROUND_Y - 80 }),
      ],
      goal: { x: 600, y: GROUND_Y - 60, width: 40, height: 60 },
    });
    pilot.drive(scene({ board: passage }));
    expect(pilot.status.errand.kind).toBe("objective");

    const resizing = {
      ...alice({ x: 100, y: GROUND_Y }),
      sizeMultiplier: 2,
      headingScale: 2,
    };
    pilot.drive(scene({ board: passage, alice: resizing }));
    expect(pilot.status.errand.kind).toBe("wait");
    expect(pilot.status.stuck).toBe(true);
  });

  it("uses law-scaled meal footprints and retains the larger body during shrinking", () => {
    const enlarged = alice({ x: 100, y: GROUND_Y }, "normal", 2);
    expect(footprintFor(enlarged)).toEqual({ cols: 7, rows: 15 });
    expect(footprintFor(enlarged, "big")).toEqual({ cols: 14, rows: 30 });
    expect(footprintFor(enlarged, "small")).toEqual({ cols: 4, rows: 8 });
    expect(footprintFor({ ...enlarged, sizeMultiplier: 1, headingScale: 1 })).toEqual({
      cols: 7,
      rows: 15,
    });
  });

  it("walks out from a low ceiling before deferred law growth starts for Alice and her twin", () => {
    const passage = board({
      solids: [
        solid({ x: 0, y: GROUND_Y, width: 1000, height: 40 }),
        solid({ x: 0, y: GROUND_Y - 90, width: 300, height: 10 }),
      ],
      goal: { x: 700, y: GROUND_Y - 60, width: 40, height: 60 },
    });
    const sim = enter(passage);
    sim.setPhysics({ ...EARTH, aliceSize: 2, clones: 1 });
    runSteps(sim, 60);
    const deferred = sim.snapshot();
    for (const each of [aliceOf(sim), ...deferred.twins]) {
      expect(each.height).toBeCloseTo(ALICE_BASE.height);
      expect(each.headingScale).toBe(1);
      expect(each.sizeMultiplier).toBe(2);
    }
    expect(footprintFor(aliceOf(sim), "big")).toEqual({ cols: 14, rows: 30 });

    const pilots = [createAutopilot(), createAutopilot()];
    const currentScene = (who: number): Scene => {
      const alices = sim.alices();
      return scene({
        board: passage,
        alice: alices[who] ?? aliceOf(sim),
        others: alices.filter((_, index) => index !== who),
        walkSpeed: sim.walkSpeed(who),
        jumpArc: sim.jumpArc(who),
      });
    };
    expect(pilots[0]?.drive(currentScene(0))).toEqual({ x: 1, y: 0 });
    expect(pilots[0]?.status.errand.kind).toBe("objective");
    for (let tick = 0; tick < 240; tick++) {
      for (const [who, pilot] of pilots.entries()) {
        sim.setWalkIntent(pilot.drive(currentScene(who)), who);
      }
      sim.step();
    }
    const grown = sim.snapshot();
    expect(grown.twins).toHaveLength(1);
    for (const each of [aliceOf(sim), ...grown.twins]) {
      expect(each.center.x).toBeGreaterThan(400);
      expect(each.width).toBeCloseTo(ALICE_BASE.width * 2);
      expect(each.height).toBeCloseTo(ALICE_BASE.height * 2);
      expect(each.headingScale).toBe(2);
    }
  });

  it("waits safely on an oversized world without modifying the artwork", () => {
    const drawing = ink(
      [
        { x: 1e9, y: 100 },
        { x: 1e9 + 20, y: 100 },
      ],
      "goal",
    );
    const original = structuredClone(drawing);
    const distant = scene({ inks: [drawing] });
    expect(Chart.of(distant)).toBeNull();
    const pilot = createAutopilot();
    expect(pilot.drive(distant)).toEqual({ x: 0, y: 0 });
    expect(pilot.status).toMatchObject({ errand: { kind: "wait" }, stuck: true, target: null });
    expect(drawing).toEqual(original);
  });

  it("rejects long airborne excursions and oversized or unsafe chart dimensions", () => {
    expect(Chart.of(scene({ alice: alice({ x: 100, y: -1e8 }), canFly: true }))).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({ solids: [solid({ x: 0, y: 400, width: 1e8, height: 40 })] }),
        }),
      ),
    ).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({
            solids: [solid({ x: 0, y: 0, width: 10000, height: 10000 })],
            killY: 20000,
          }),
        }),
      ),
    ).toBeNull();
    expect(Chart.of(scene({ alice: alice({ x: Number.POSITIVE_INFINITY, y: 400 }) }))).toBeNull();
  });

  it("bounds input geometry and repeated segment stamping independently of cell allocation", () => {
    const dense = ink(Array.from({ length: 50_001 }, () => ({ x: 100, y: 100 })));
    expect(Chart.of(scene({ inks: [dense] }))).toBeNull();
    const repeated = ink(Array.from({ length: 5000 }, (_, i) => ({ x: i % 2 ? 0 : 2000, y: 380 })));
    expect(Chart.of(scene({ inks: [repeated] }))).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({ solids: [solid({ x: 0, y: 400, width: 1000, height: 1e9 })] }),
        }),
      ),
    ).toBeNull();
    expect(
      Chart.of(
        scene({
          board: board({ solids: [solid({ x: 0, y: 400, width: 0, height: 1e9 })] }),
        }),
      ),
    ).toBeNull();
  });

  it("preserves normal chart geometry within the allocation limit", () => {
    const chart = Chart.of(scene({ inks: [ink([{ x: 600, y: 200 }], "hazard")] }));
    if (chart === null) throw new Error("ordinary chart refused");
    const { c0, c1, r0, r1 } = chart.range;
    expect((c1 - c0) * (r1 - r0)).toBeLessThanOrEqual(MAX_CHART_CELLS);
    expect(chart.has(600 / CELL_PX, 200 / CELL_PX, CellFlag.hazard)).toBe(true);
    expect(chart.has(Math.floor(100 / CELL_PX), GROUND_Y / CELL_PX, CellFlag.fixture)).toBe(true);
  });

  it("routes across a compact scene at large absolute coordinates without key aliasing", () => {
    const offset = 1e12;
    const ground = GROUND_Y + offset;
    const pilot = createAutopilot();
    const far = scene({
      alice: alice({ x: offset + 100, y: ground }),
      board: board({
        spawn: { x: offset + 100, y: ground },
        solids: [solid({ x: offset, y: ground, width: 1000, height: 40 })],
        goal: { x: offset + 600, y: ground - 60, width: 40, height: 60 },
        killY: ground + 1000,
      }),
    });
    expect(pilot.drive(far).x).toBe(1);
    expect(pilot.status.errand.kind).toBe("objective");
    expect(pilot.status.stuck).toBe(false);
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
    if (creature === null || plain === null) throw new Error("ordinary chart refused");
    expect(creature.has(cellThroughHer.c, cellThroughHer.r, CellFlag.solid)).toBe(false);
    expect(plain.has(cellThroughHer.c, cellThroughHer.r, CellFlag.solid)).toBe(true);

    const beside = Chart.of(
      scene({
        inks: [ink(line({ x: 150, y: GROUND_Y - 30 }, { x: 170, y: GROUND_Y - 30 }), "walker")],
      }),
    );
    if (beside === null) throw new Error("ordinary chart refused");
    expect(beside.has(Math.floor(160 / CELL_PX), cellThroughHer.r, CellFlag.solid)).toBe(true);
  });

  it("never charts another Alice as solid, whether she stands apart or leans on this one", () => {
    const cellAt = (x: number) => ({
      c: Math.floor(x / CELL_PX),
      r: Math.floor((GROUND_Y - 30) / CELL_PX),
    });
    for (const x of [130, 300]) {
      const chart = Chart.of(scene({ others: [alice({ x, y: GROUND_Y })] }));
      if (chart === null) throw new Error("ordinary chart refused");
      const { c, r } = cellAt(x);
      expect(chart.has(c, r, CellFlag.solid)).toBe(false);
      expect(chart.has(c, r + 1, CellFlag.solid)).toBe(false);
      expect(chart.has(c, Math.floor(GROUND_Y / CELL_PX), CellFlag.solid)).toBe(true);
    }
    const creatureOnHer = Chart.of(
      scene({
        others: [alice({ x: 300, y: GROUND_Y })],
        inks: [ink(line({ x: 290, y: GROUND_Y - 30 }, { x: 310, y: GROUND_Y - 30 }), "walker")],
      }),
    );
    if (creatureOnHer === null) throw new Error("ordinary chart refused");
    expect(creatureOnHer.has(cellAt(300).c, cellAt(300).r, CellFlag.solid)).toBe(false);
  });

  it("wanders when hired to, each seed setting off her own way, and idles otherwise", () => {
    const meadow = board({ solids: [solid({ x: -2000, y: GROUND_Y, width: 4000, height: 40 })] });
    const hire = (seed: number, wanders = true) =>
      createAutopilot({ seed, wanders, charter: Chart.of });
    const at = (x: number): Scene => scene({ board: meadow, alice: alice({ x, y: GROUND_Y }) });

    expect(hire(0, false).drive(at(100))).toEqual({ x: 0, y: 0 });
    const odd = hire(1);
    const even = hire(2);
    expect(odd.drive(at(100)).x).toBe(-1);
    expect(even.drive(at(100)).x).toBe(1);
    expect(odd.status.errand).toEqual({ kind: "wander", heading: -1 });
    expect(even.status.errand).toEqual({ kind: "wander", heading: 1 });
    expect(hire(1).drive(at(100))).toEqual(hire(1).drive(at(100)));
    for (const pilot of [odd, even]) expect(pilot.status.stuck).toBe(false);
  });

  it("charts a vehicle deck under Alice even when its decorative cabin surrounds her", () => {
    const deck = ink(line({ x: 50, y: 350 }, { x: 180, y: 350 }), "vehicle");
    const vehicle: SceneInk = {
      ...deck,
      drawing: {
        ...deck.drawing,
        strokes: [
          ...deck.drawing.strokes,
          [
            { x: 70, y: 350 },
            { x: 70, y: 280 },
            { x: 160, y: 280 },
            { x: 160, y: 350 },
          ],
        ],
      },
    };
    const chart = Chart.of(scene({ inks: [vehicle], alice: alice({ x: 100, y: 345 }) }));
    if (chart === null) throw new Error("ordinary chart refused");

    expect(chart.has(Math.floor(100 / CELL_PX), Math.floor(350 / CELL_PX), CellFlag.solid)).toBe(
      true,
    );
    expect(chart.has(Math.floor(70 / CELL_PX), Math.floor(320 / CELL_PX), CellFlag.solid)).toBe(
      false,
    );
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

  it("steps through a twinned portal to reach a goal it could not otherwise", () => {
    const pilot = createAutopilot();
    const goal: Rect = { x: 700, y: GROUND_Y - 60, width: 40, height: 60 };
    const ring = (centre: Vec): Vec[] =>
      Array.from({ length: 25 }, (_, i) => ({
        x: centre.x + 24 * Math.cos((i / 24) * Math.PI * 2),
        y: centre.y + 30 * Math.sin((i / 24) * Math.PI * 2),
      }));
    const here = ink(ring({ x: 220, y: GROUND_Y - 34 }), "portal");
    const there = ink(ring({ x: 600, y: GROUND_Y - 34 }), "portal");

    pilot.drive(scene({ board: board({ goal }), inks: [here] }));
    expect(pilot.status.errand).toEqual({ kind: "wait", objective: "goal" });

    pilot.invalidate();
    const intent = pilot.drive(scene({ board: board({ goal }), inks: [here, there] }));

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

  it.each([
    { size: "big" as const, scale: 2, gravity: 1, ditch: 96 },
    { size: "normal" as const, scale: 1, gravity: 0.165, ditch: 64 },
  ])(
    "keeps $size jumps under gravity $gravity above the raster clear",
    ({ size, scale, gravity, ditch }) => {
      const feet = { x: GAP.x - 40, y: GROUND_Y };
      const current = scene({
        alice: alice(feet, size),
        board: board({
          goal: { x: 700, y: GROUND_Y - 60, width: 40, height: 60 },
          solids: [
            solid({ x: 0, y: GROUND_Y, width: GAP.x, height: 40 }),
            solid({ x: GAP.x + ditch, y: GROUND_Y, width: 500, height: 40 }),
          ],
        }),
        walkSpeed: walkSpeedAt(scale),
        jumpArc: jumpArcUnder({ ...EARTH, gravity: { x: 0, y: gravity } }, scale),
      });
      const chart = Chart.of(current);
      if (chart === null) throw new Error("ordinary chart refused");
      expect(GROUND_Y - current.jumpArc.apexPx - current.alice.height).toBeLessThan(
        chart.range.r0 * CELL_PX,
      );
      const footprint = footprintFor(current.alice);
      const finder = new Pathfinder(chart, current, footprint);
      const path = finder.route(nodeOfFeet(feet, footprint), {
        kind: "objective",
        objective: "goal",
      });
      expect(path?.some((waypoint) => waypoint.via === "jump")).toBe(true);
      expect(path?.every((waypoint) => finder.isFree(waypoint.node))).toBe(true);
      const pilot = createAutopilot();
      expect(pilot.drive(current).x).toBe(1);
      expect(pilot.status).toMatchObject({ errand: { kind: "objective" }, stuck: false });

      const ceiling = solid({
        x: 0,
        y: GROUND_Y - current.alice.height - current.jumpArc.apexPx - 16,
        width: 1000,
        height: current.jumpArc.apexPx + 8,
      });
      pilot.invalidate();
      pilot.drive(
        scene({
          ...current,
          board: { ...current.board, solids: [...current.board.solids, ceiling] },
        }),
      );
      expect(pilot.status.errand.kind).toBe("wait");
    },
  );

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
