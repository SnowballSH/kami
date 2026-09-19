// @vitest-environment node
import { describe, expect, it } from "vitest";
import { circleSketch, lineSketch } from "../testing/sketches";
import { type Outcome, runTrial, sweepLeaderFloor, TRIALS, tally } from "./evaluation";
import { prefixFeaturesOf } from "./prefixFeatures";
import { QuickdrawRecognizer } from "./recognizer";

const SAMPLES_PER_SHAPE = 10;

const recognizer = new QuickdrawRecognizer(
  Array.from({ length: SAMPLES_PER_SHAPE }, (_, index) => [
    ...prefixFeaturesOf(circleSketch({ x: 0, y: 0 }, 40 + index, index * 0.01)).map((row) => ({
      category: "circle",
      ...row,
    })),
    ...prefixFeaturesOf(lineSketch({ x: 0, y: index }, { x: 200, y: index * 3 })).map((row) => ({
      category: "line",
      ...row,
    })),
  ]).flat(),
);

const outcome = (leaderConfidence: number, top1: boolean, spoke: boolean): Outcome => ({
  category: "circle",
  fraction: 0.4,
  partial: true,
  leaderConfidence,
  top1,
  top3: top1,
  spoke,
  milliseconds: 2,
});

describe("runTrial", () => {
  it("shows the recogniser a prefix as a live guess and the whole drawing as a finished one", () => {
    const circle = { category: "circle", strokes: circleSketch({ x: 300, y: 300 }, 90, 0.02) };
    const outcomes = TRIALS.map((trial) => runTrial(recognizer, circle, trial));
    expect(outcomes.map(({ fraction, partial }) => [fraction, partial])).toEqual([
      [0.2, true],
      [0.4, true],
      [0.6, true],
      [0.8, true],
      [1, true],
      [1, false],
    ]);
    const finished = outcomes.at(-1);
    expect(finished).toMatchObject({ top1: true, top3: true, spoke: true });
    expect(finished?.leaderConfidence).toBeGreaterThan(0.5);
  });

  it("marks a wrong label as a miss", () => {
    const mislabelled = { category: "mushroom", strokes: circleSketch({ x: 0, y: 0 }, 50) };
    const finished = runTrial(recognizer, mislabelled, { fraction: 1, partial: false });
    expect(finished).toMatchObject({ top1: false, top3: false });
  });
});

describe("tally and sweepLeaderFloor", () => {
  const outcomes = [
    outcome(0.95, true, true),
    outcome(0.85, false, true),
    outcome(0.6, true, false),
    outcome(0.3, false, false),
  ];

  it("counts hits, stated guesses and how often a confident leader was right", () => {
    expect(tally(outcomes)).toEqual({
      tested: 4,
      top1: 2,
      top3: 2,
      spoke: 2,
      spokeRight: 1,
      confident: 2,
      confidentRight: 1,
      meanMilliseconds: 2,
    });
    expect(tally([]).meanMilliseconds).toBe(0);
  });

  it("shows what each leader floor would have let through", () => {
    expect(sweepLeaderFloor(outcomes, [0.5, 0.9])).toEqual([
      { floor: 0.5, spoke: 3, spokeRight: 2 },
      { floor: 0.9, spoke: 1, spokeRight: 1 },
    ]);
  });
});
