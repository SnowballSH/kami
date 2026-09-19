import type { BoardDefinition } from "../board/types";
import type { Nature, Ruling } from "../cat/types";
import { type Pose, type Stroke, strokesLength, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import { resample } from "./anchoring";
import { createSimulation } from "./index";
import type { SimEvent, Simulation, WalkIntent } from "./types";

const POINT_SPACING = 8;
const BLOB_POINTS = 28;
export const MAX_STEPS = 1800;

export const RIGHT: WalkIntent = { x: 1, y: 0 };
export const LEFT: WalkIntent = { x: -1, y: 0 };
export const UP: WalkIntent = { x: 0, y: -1 };
export const STAY: WalkIntent = { x: 0, y: 0 };

export const enter = (board: BoardDefinition): Simulation => {
  const sim = createSimulation();
  sim.loadBoard(board);
  return sim;
};

export const poseOf = (sim: Simulation, name: string): Pose | undefined =>
  sim.snapshot().drawings.find((drawing) => drawing.id === name)?.pose;

export const feetOf = (sim: Simulation): Vec => {
  const { x, y, width, height } = sim.aliceBounds();
  return { x: x + width / 2, y: y + height };
};

export const line = (from: Vec, to: Vec): Stroke => [...resample([from, to], POINT_SPACING), to];

/** A closed, vaguely elliptical scribble: `bottom` is the lowest point of its centreline. */
export const blob = (centreX: number, bottom: number, width: number, height: number): Stroke =>
  Array.from({ length: BLOB_POINTS + 1 }, (_, i) => {
    const angle = (i / BLOB_POINTS) * Math.PI * 2;
    return {
      x: centreX + (Math.cos(angle) * width) / 2,
      y: bottom - height / 2 + (Math.sin(angle) * height) / 2,
    };
  });

export const idOf = (name: string): DrawingId => name as DrawingId;

export const drawingOf = (name: string, ...strokes: readonly Stroke[]): Drawing => ({
  id: idOf(name),
  strokes,
  cost: strokesLength(strokes),
});

export const rulingOf = (nature: Nature, strength = 1): Ruling => ({
  name: nature,
  nature,
  strength,
  tags: [],
  line: "",
});

export type StopCondition = (events: readonly SimEvent[], sim: Simulation) => boolean;

/** Steps until `done` says so (or the cap) and returns every event seen on the way. */
export const runUntil = (
  sim: Simulation,
  done: StopCondition,
  maxSteps = MAX_STEPS,
): readonly SimEvent[] => {
  const events: SimEvent[] = [];
  for (let step = 0; step < maxSteps && !done(events, sim); step++) events.push(...sim.step());
  return events;
};

export const runSteps = (sim: Simulation, steps: number): readonly SimEvent[] =>
  runUntil(sim, () => false, steps);

export const saw =
  (type: SimEvent["type"]): StopCondition =>
  (events) =>
    events.some((event) => event.type === type);

/** Grounded with her feet at `top`, at or beyond `fromX`. */
export const standsOn =
  (top: number, fromX: number): StopCondition =>
  (_events, sim) => {
    const feet = feetOf(sim);
    return sim.snapshot().alice.grounded && feet.x >= fromX && Math.abs(feet.y - top) < 2;
  };

export const typesOf = (events: readonly SimEvent[]): readonly SimEvent["type"][] =>
  events.map((event) => event.type);

/** Everything that happened except arriving somewhere new. */
export const happeningsOf = (events: readonly SimEvent[]): readonly SimEvent["type"][] =>
  typesOf(events).filter((type) => type !== "zone-entered");

export const zonesOf = (events: readonly SimEvent[]): readonly string[] =>
  events.flatMap((event) => (event.type === "zone-entered" ? [event.zoneId] : []));
