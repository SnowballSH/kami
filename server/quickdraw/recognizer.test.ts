// @vitest-environment node
import { describe, expect, it } from "vitest";
import { circleSketch, lineSketch } from "../testing/sketches";
import { computeFeature } from "./feature";
import { type LabelledFeature, QuickdrawRecognizer } from "./recognizer";

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
});
