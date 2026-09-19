import type { Stroke } from "../../src/core/geometry";
import { COMPLETE_FRACTION, prefixOfStrokes } from "./prefix";
import {
  DEFAULT_RECOGNIZER_OPTIONS,
  type QuickdrawRecognizer,
  type RecognizerOptions,
  statedGuesses,
} from "./recognizer";

/** How much of each held-out drawing the recogniser is shown, as shares of its points. */
export const INK_BUCKETS = [0.2, 0.4, 0.6, 0.8, 1] as const;
export const HIGH_CONFIDENCE = 0.8;

export interface LabelledSketch {
  readonly category: string;
  readonly strokes: readonly Stroke[];
}

export interface Trial {
  readonly fraction: number;
  readonly partial: boolean;
}

/** Every bucket as a live guess, then the whole drawing once more as a finished one. */
export const TRIALS: readonly Trial[] = [
  ...INK_BUCKETS.map((fraction) => ({ fraction, partial: true })),
  { fraction: COMPLETE_FRACTION, partial: false },
];

export interface Outcome extends Trial {
  readonly category: string;
  readonly leaderConfidence: number;
  readonly top1: boolean;
  readonly top3: boolean;
  readonly spoke: boolean;
  readonly milliseconds: number;
}

export interface Tally {
  readonly tested: number;
  readonly top1: number;
  readonly top3: number;
  readonly spoke: number;
  readonly spokeRight: number;
  readonly confident: number;
  readonly confidentRight: number;
  readonly meanMilliseconds: number;
}

export const runTrial = (
  recognizer: QuickdrawRecognizer,
  { category, strokes }: LabelledSketch,
  { fraction, partial }: Trial,
  options: RecognizerOptions = DEFAULT_RECOGNIZER_OPTIONS,
): Outcome => {
  const shown = prefixOfStrokes(strokes, fraction);
  const startedAt = performance.now();
  const scored = recognizer.score(shown, { partial });
  const milliseconds = performance.now() - startedAt;
  const ranked = statedGuesses(scored, false, options).map((guess) => guess.category);
  return {
    category,
    fraction,
    partial,
    leaderConfidence: scored[0]?.confidence ?? 0,
    top1: ranked[0] === category,
    top3: ranked.includes(category),
    spoke: statedGuesses(scored, partial, options).length > 0,
    milliseconds,
  };
};

const count = (outcomes: readonly Outcome[], wanted: (outcome: Outcome) => boolean): number =>
  outcomes.filter(wanted).length;

export const tally = (outcomes: readonly Outcome[]): Tally => ({
  tested: outcomes.length,
  top1: count(outcomes, ({ top1 }) => top1),
  top3: count(outcomes, ({ top3 }) => top3),
  spoke: count(outcomes, ({ spoke }) => spoke),
  spokeRight: count(outcomes, ({ spoke, top1 }) => spoke && top1),
  confident: count(outcomes, ({ leaderConfidence }) => leaderConfidence >= HIGH_CONFIDENCE),
  confidentRight: count(
    outcomes,
    ({ leaderConfidence, top1 }) => leaderConfidence >= HIGH_CONFIDENCE && top1,
  ),
  meanMilliseconds:
    outcomes.reduce((sum, { milliseconds }) => sum + milliseconds, 0) /
    Math.max(1, outcomes.length),
});

export interface FloorReading {
  readonly floor: number;
  readonly spoke: number;
  readonly spokeRight: number;
}

/** What a leader floor would have let through: the evidence the partial floor is tuned on. */
export const sweepLeaderFloor = (
  outcomes: readonly Outcome[],
  floors: readonly number[],
): readonly FloorReading[] =>
  floors.map((floor) => ({
    floor,
    spoke: count(outcomes, ({ leaderConfidence }) => leaderConfidence >= floor),
    spokeRight: count(outcomes, ({ leaderConfidence, top1 }) => leaderConfidence >= floor && top1),
  }));
