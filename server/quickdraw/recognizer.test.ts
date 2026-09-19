// @vitest-environment node
import { describe, expect, it } from "vitest";
import { circleSketch, lineSketch } from "../testing/sketches";
import { computeFeature } from "./feature";
import { prefixOfStrokes } from "./prefix";
import {
  asAsyncRecognizer,
  DEFAULT_RECOGNIZER_OPTIONS,
  type LabelledFeature,
  QuickdrawRecognizer,
  statedGuesses,
} from "./recognizer";

const SAMPLES_PER_SHAPE = 12;

const syntheticSamples = (): readonly LabelledFeature[] =>
  Array.from({ length: SAMPLES_PER_SHAPE }, (_, index) => [
    {
      category: "circle",
      feature: computeFeature(circleSketch({ x: index * 10, y: 0 }, 40 + index, index * 0.01)),
    },
    {
      category: "line",
      feature: computeFeature(lineSketch({ x: 0, y: index }, { x: 200 + index * 5, y: index * 3 })),
    },
  ]).flat();

describe("QuickdrawRecognizer", () => {
  it("tells circles from lines, best guess first", () => {
    const recognizer = new QuickdrawRecognizer(syntheticSamples());
    expect(recognizer.recognize(circleSketch({ x: 900, y: 900 }, 300, 0.03))[0]).toBe("circle");
    expect(recognizer.recognize(lineSketch({ x: -50, y: 10 }, { x: 640, y: 22 }))[0]).toBe("line");
  });

  it("returns each category at most once and never more than three", () => {
    const guesses = new QuickdrawRecognizer(syntheticSamples()).recognize(
      circleSketch({ x: 0, y: 0 }, 10),
    );
    expect(new Set(guesses).size).toBe(guesses.length);
    expect(guesses.length).toBeLessThanOrEqual(3);
  });

  it("has nothing to say with no samples, no ink, or something unlike anything it knows", () => {
    expect(new QuickdrawRecognizer([]).recognize(circleSketch({ x: 0, y: 0 }, 10))).toEqual([]);
    expect(new QuickdrawRecognizer(syntheticSamples()).recognize([])).toEqual([]);
    const onlyLines = syntheticSamples().filter(({ category }) => category === "line");
    const upright = lineSketch({ x: 0, y: 0 }, { x: 2, y: 400 });
    expect(new QuickdrawRecognizer(onlyLines).recognize(upright)).toEqual([]);
  });

  it("ignores stored features of the wrong length", () => {
    const stale = [{ category: "circle", feature: new Float32Array(16).fill(0.25) }];
    expect(new QuickdrawRecognizer(stale).size).toBe(0);
  });

  it("answers through a promise with the same guesses, for callers that also ask remote models", async () => {
    const recognizer = new QuickdrawRecognizer(syntheticSamples());
    const circle = circleSketch({ x: 0, y: 0 }, 120);
    expect(await asAsyncRecognizer(recognizer).rank(circle)).toEqual(recognizer.rank(circle));
    expect(await asAsyncRecognizer(recognizer).rank(circle, { partial: true })).toEqual(
      recognizer.rank(circle, { partial: true }),
    );
  });
});

const HALF = 0.5;

const arcAndLineSamples = (): readonly LabelledFeature[] =>
  Array.from({ length: SAMPLES_PER_SHAPE }, (_, index) => {
    const circle = circleSketch({ x: 0, y: 0 }, 40 + index, index * 0.01);
    const line = lineSketch({ x: 0, y: index }, { x: 200 + index * 5, y: index * 3 });
    return [
      { category: "circle", fraction: 1, feature: computeFeature(circle) },
      {
        category: "circle",
        fraction: HALF,
        feature: computeFeature(prefixOfStrokes(circle, HALF)),
      },
      { category: "line", fraction: 1, feature: computeFeature(line) },
    ];
  }).flat();

describe("a drawing still under the pen", () => {
  const halfCircle = prefixOfStrokes(circleSketch({ x: 700, y: -40 }, 220, 0.02), HALF);

  it("is compared with half-finished sketches only when it says it is partial", () => {
    const recognizer = new QuickdrawRecognizer(arcAndLineSamples());
    expect(recognizer.rows).toBe(SAMPLES_PER_SHAPE * 3);
    expect(recognizer.size).toBe(SAMPLES_PER_SHAPE * 2);
    const relabelled = new QuickdrawRecognizer(
      arcAndLineSamples().map((sample) =>
        sample.fraction === HALF ? { ...sample, category: "half a circle" } : sample,
      ),
    );
    expect(relabelled.score(halfCircle, { partial: true })[0]?.category).toBe("half a circle");
    expect(relabelled.score(halfCircle).map(({ category }) => category)).not.toContain(
      "half a circle",
    );
  });

  it("is named when the leader is sure, and met with silence when it is not", () => {
    const recognizer = new QuickdrawRecognizer(arcAndLineSamples());
    expect(recognizer.recognize(halfCircle, { partial: true })[0]).toBe("circle");

    const torn = [
      { category: "circle", confidence: 0.55 },
      { category: "moon", confidence: 0.45 },
    ];
    expect(DEFAULT_RECOGNIZER_OPTIONS.partialLeaderFloor).toBeGreaterThan(0.55);
    expect(statedGuesses(torn, true)).toEqual([]);
    expect(statedGuesses(torn, false)).toEqual(torn);
  });

  it("does not give up on a couple of points", () => {
    const recognizer = new QuickdrawRecognizer(arcAndLineSamples());
    const twoPoints = [
      [
        { x: 10, y: 10 },
        { x: 90, y: 12 },
      ],
    ];
    expect(recognizer.recognize(twoPoints, { partial: true })).toEqual(["line"]);
  });
});
