import type { Nature, Ruling } from "../cat/types";
import { type Stroke, strokesLength, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import { resample } from "./anchoring";
import type { SimEvent, Simulation } from "./types";

const POINT_SPACING = 8;
const BLOB_POINTS = 28;
export const MAX_STEPS = 1800;

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

export type StopCondition = (events: readonly SimEvent[]) => boolean;

/** Steps until `done` says so (or the cap) and returns every event seen on the way. */
export const runUntil = (
  sim: Simulation,
  done: StopCondition,
  maxSteps = MAX_STEPS,
): readonly SimEvent[] => {
  const events: SimEvent[] = [];
  for (let step = 0; step < maxSteps && !done(events); step++) events.push(...sim.step());
  return events;
};

export const runSteps = (sim: Simulation, steps: number): readonly SimEvent[] =>
  runUntil(sim, () => false, steps);

export const saw =
  (type: SimEvent["type"]): StopCondition =>
  (events) =>
    events.some((event) => event.type === type);

export const typesOf = (events: readonly SimEvent[]): readonly SimEvent["type"][] =>
  events.map((event) => event.type);
