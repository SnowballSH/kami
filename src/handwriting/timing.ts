import { type Stroke, strokeLength } from "../core/geometry";

/** What the pen did just before a stroke: nothing yet, a hop within a word, to a new word, or to a new line. */
export type PenLift = "start" | "stroke" | "word" | "line";

export interface PlannedStroke {
  readonly points: Stroke;
  readonly lift: PenLift;
}

export interface StrokeSchedule {
  readonly startsAtMs: readonly number[];
  readonly endsAtMs: readonly number[];
  readonly durationMs: number;
}

const REFERENCE_EM_SIZE = 28;
const PEN_SPEED_AT_REFERENCE_EM_SIZE = 0.9;
const MIN_STROKE_MS = 30;

const LIFT_MS: Readonly<Record<PenLift, number>> = {
  start: 0,
  stroke: 25,
  word: 70,
  line: 140,
};

const LIFT_RANK: Readonly<Record<PenLift, number>> = { stroke: 0, word: 1, line: 2, start: 3 };

export const longerLift = (a: PenLift, b: PenLift): PenLift =>
  LIFT_RANK[a] >= LIFT_RANK[b] ? a : b;

/** World px per ms; bigger writing moves the pen proportionally faster, so a line takes as long at any size. */
export const penSpeed = (emSize: number): number =>
  (PEN_SPEED_AT_REFERENCE_EM_SIZE * emSize) / REFERENCE_EM_SIZE;

export const scheduleStrokes = (
  strokes: readonly PlannedStroke[],
  emSize: number,
): StrokeSchedule => {
  const speed = penSpeed(emSize);
  const startsAtMs: number[] = [];
  const endsAtMs: number[] = [];
  let clock = 0;
  for (const { points, lift } of strokes) {
    clock += LIFT_MS[lift];
    startsAtMs.push(clock);
    clock += Math.max(MIN_STROKE_MS, speed > 0 ? strokeLength(points) / speed : 0);
    endsAtMs.push(clock);
  }
  return { startsAtMs, endsAtMs, durationMs: clock };
};
