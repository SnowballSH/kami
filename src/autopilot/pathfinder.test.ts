import { describe, expect, it } from "vitest";
import { boardFor } from "../board";
import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { EARTH } from "../rules/types";
import { bounceArcUnder, jumpArcUnder, walkSpeedAt } from "../sim/flight";
import { blob, drawingOf, line } from "../sim/testSupport";
import { ALICE_BASE, type AliceSize, type AliceSnapshot } from "../sim/types";
import { Chart } from "./chart";
import {
  type Footprint,
  footprintFor,
  type Goal,
  type Node,
  nodeOfFeet,
  Pathfinder,
} from "./pathfinder";
import type { Scene, SceneInk } from "./types";

const WONDERLAND = boardFor("wonderland");
const NATURES: readonly Nature[] = ["ink", "bouncy", "climbable", "hazard", "grow", "shrink"];

const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

const aliceAt = (feet: Vec, size: AliceSize): AliceSnapshot => {
  const scale = size === "big" ? 2 : size === "small" ? 0.5 : 1;
  const height = ALICE_BASE.height * scale;
  return {
    center: { x: feet.x, y: feet.y - height / 2 },
    velocity: { x: 0, y: 0 },
    width: ALICE_BASE.width * scale,
    height,
    size,
    sizeMultiplier: 1,
    innateScale: 1,
    scale,
    headingScale: scale,
    facing: 1,
    walking: false,
    grounded: true,
    climbing: false,
    hasKey: false,
    ride: null,
    look: { kind: "alice" },
  };
};

const inkOf = (index: number, next: () => number): SceneInk => {
  const { spawn } = WONDERLAND;
  const x = spawn.x + 150 + next() * 1400;
  const y = spawn.y - 40 - next() * 360;
  const width = 40 + next() * 120;
  const nature = NATURES[Math.floor(next() * NATURES.length)] ?? "ink";
  const stroke =
    next() < 0.3 ? blob(x, y, width, 30) : line({ x, y }, { x: x + width, y: y + next() * 20 });
  return {
    drawing: drawingOf(`scribble-${index}`, stroke),
    pose: { origin: { x: 0, y: 0 }, position: { x: 0, y: 0 }, angle: 0, scale: 1 },
    nature,
    strength: 0.5 + next(),
  };
};

const sceneOf = (seed: number, size: AliceSize): Scene => {
  const next = random(seed);
  return {
    board: WONDERLAND,
    alice: aliceAt(WONDERLAND.spawn, size),
    others: [],
    inks: Array.from({ length: 24 }, (_, index) => inkOf(index, next)),
    bites: [],
    sumikui: null,
    keyTaken: false,
    doorOpen: false,
    walkSpeed: walkSpeedAt(1),
    canFly: false,
    bounceArc: (strength) => bounceArcUnder(EARTH, strength),
    jumpArc: jumpArcUnder(EARTH, 1),
  };
};

const goalsOf = (scene: Scene): readonly Goal[] => [
  { kind: "objective", objective: "key" },
  { kind: "objective", objective: "door" },
  { kind: "objective", objective: "goal" },
  ...scene.inks
    .filter((ink) => ink.nature === "grow" || ink.nature === "shrink")
    .map((ink): Goal => ({ kind: "eat", drawingId: ink.drawing.id as DrawingId })),
];

/** Every question the pilot asks, in one order, so a memoising pathfinder answers them all on one memory. */
const askAll = (finder: Pathfinder, start: Node, scene: Scene, footprint: Footprint) => {
  const { spawn } = scene.board;
  const points: readonly Vec[] = [
    { x: spawn.x + 900, y: spawn.y - 200 },
    { x: spawn.x - 400, y: spawn.y },
    { x: spawn.x + 1600, y: spawn.y - 400 },
  ];
  return {
    start,
    free: finder.isFree(start),
    routes: goalsOf(scene).map((goal) => finder.route(start, goal)),
    nearest: points.map((point) => finder.nearestTo(start, point)),
    away: points.map((point) => finder.awayFrom(start, point, 240)),
    footprint,
  };
};

describe("Pathfinder memo", () => {
  const cases = [1, 2, 3, 4].flatMap((seed) =>
    (["small", "normal", "big"] as const).map((size) => ({ seed, size })),
  );

  it.each(cases)(
    "finds the same ways with and without memory (seed $seed, $size)",
    ({ seed, size }) => {
      const scene = sceneOf(seed, size);
      const chart = Chart.of(scene);
      expect(chart).not.toBeNull();
      if (chart === null) return;
      const footprint = footprintFor(scene.alice);
      const start = nodeOfFeet(WONDERLAND.spawn, footprint);
      const remembering = askAll(new Pathfinder(chart, scene, footprint), start, scene, footprint);
      const forgetful = askAll(
        new Pathfinder(chart, scene, footprint, { memoise: false }),
        start,
        scene,
        footprint,
      );
      expect(remembering).toEqual(forgetful);
      expect(remembering.nearest.some((path) => (path?.length ?? 0) > 1)).toBe(true);
    },
  );

  it("keeps falls into a goal down a ditch apart from falls taken with no goal in mind", () => {
    const ground = 400;
    const board: BoardDefinition = {
      id: "ditch",
      title: "Ditch",
      spawn: { x: 100, y: ground },
      killY: 1400,
      solids: [
        { rect: { x: 0, y: ground, width: 300, height: 40 }, material: "marker" },
        { rect: { x: 300, y: 1100, width: 200, height: 40 }, material: "marker" },
        { rect: { x: 500, y: ground, width: 500, height: 40 }, material: "marker" },
      ],
      zones: [],
      noInkZones: [],
      goal: { x: 300, y: 600, width: 200, height: 40 },
    };
    const scene: Scene = {
      ...sceneOf(6, "normal"),
      board,
      inks: [],
      alice: aliceAt(board.spawn, "normal"),
    };
    const chart = Chart.of(scene);
    if (chart === null) throw new Error("the ditch should chart");
    const footprint = footprintFor(scene.alice);
    const start = nodeOfFeet(board.spawn, footprint);
    const ask = (finder: Pathfinder) => ({
      looking: finder.nearestTo(start, { x: 400, y: 1100 }),
      going: finder.route(start, { kind: "objective", objective: "goal" }),
    });
    const remembering = ask(new Pathfinder(chart, scene, footprint));
    expect(remembering).toEqual(ask(new Pathfinder(chart, scene, footprint, { memoise: false })));
    expect(remembering.going?.at(-1)?.node.r0).toBeLessThan(1100 / 8);
  });

  it("finds the same ways from a start off the chart", () => {
    const scene = sceneOf(5, "normal");
    const chart = Chart.of(scene);
    if (chart === null) throw new Error("wonderland should chart");
    const footprint = footprintFor(scene.alice);
    const start = { c0: chart.range.c0 - 40, r0: chart.range.r0 - 40 };
    const remembering = askAll(new Pathfinder(chart, scene, footprint), start, scene, footprint);
    const forgetful = askAll(
      new Pathfinder(chart, scene, footprint, { memoise: false }),
      start,
      scene,
      footprint,
    );
    expect(remembering).toEqual(forgetful);
  });
});
