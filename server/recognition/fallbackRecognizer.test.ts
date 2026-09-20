// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lineSketch } from "../testing/sketches";
import { FallbackRecognizer } from "./fallbackRecognizer";
import type { RankOptions, Reading, SketchRanker, UnreliableSketchRanker } from "./types";

const SKETCH = lineSketch({ x: 0, y: 0 }, { x: 50, y: 80 });
const FROM_EYE: Reading = { ranking: [{ category: "cake", confidence: 0.9 }], certainAbove: 0.85 };
const FROM_KNN: Reading = {
  ranking: [{ category: "circle", confidence: 0.4 }],
  certainAbove: null,
};
const BREAKER = { failureThreshold: 3, coolDownMs: 5_000 };

class ScriptedEye implements UnreliableSketchRanker {
  alive = true;
  readonly asked: RankOptions[] = [];

  async read(_strokes: unknown, options: RankOptions = {}): Promise<Reading | null> {
    this.asked.push(options);
    return this.alive ? FROM_EYE : null;
  }
}

const knn: SketchRanker = { read: async () => FROM_KNN };

const chainAt = (eye: UnreliableSketchRanker, clock: { now: number }, heard: boolean[] = []) =>
  new FallbackRecognizer(eye, knn, {
    breaker: BREAKER,
    now: () => clock.now,
    onPrimaryAvailabilityChange: (available) => heard.push(available),
  });

describe("FallbackRecognizer", () => {
  it("answers from the primary and passes the partial flag along", async () => {
    const eye = new ScriptedEye();
    const chain = chainAt(eye, { now: 0 });
    expect(await chain.read(SKETCH, { partial: true })).toBe(FROM_EYE);
    expect(chain.lastAnsweredBy).toBe("primary");
    expect(eye.asked).toEqual([{ partial: true }]);
  });

  it("answers from the floor when the primary has nothing, or throws", async () => {
    const eye = new ScriptedEye();
    eye.alive = false;
    const chain = chainAt(eye, { now: 0 });
    expect(await chain.readWithSource(SKETCH)).toEqual({ source: "floor", reading: FROM_KNN });
    expect(chain.lastAnsweredBy).toBe("floor");

    const throwing: UnreliableSketchRanker = { read: () => Promise.reject(new Error("boom")) };
    expect(await chainAt(throwing, { now: 0 }).read(SKETCH)).toBe(FROM_KNN);
  });

  it("hands on the certainty floor of whichever recogniser answered", async () => {
    const eye = new ScriptedEye();
    const chain = chainAt(eye, { now: 0 });
    expect((await chain.read(SKETCH)).certainAbove).toBe(FROM_EYE.certainAbove);
    eye.alive = false;
    expect((await chain.read(SKETCH)).certainAbove).toBe(FROM_KNN.certainAbove);
    eye.alive = true;
    expect((await chain.read(SKETCH)).certainAbove).toBe(FROM_EYE.certainAbove);
  });

  it("stops asking a dead primary, probes once per cool-down, and recovers", async () => {
    const eye = new ScriptedEye();
    eye.alive = false;
    const clock = { now: 0 };
    const heard: boolean[] = [];
    const chain = chainAt(eye, clock, heard);

    for (let sketch = 0; sketch < 10; sketch += 1) await chain.read(SKETCH);
    expect(eye.asked).toHaveLength(BREAKER.failureThreshold);
    expect(heard).toEqual([false]);

    clock.now += BREAKER.coolDownMs;
    await chain.read(SKETCH);
    await chain.read(SKETCH);
    expect(eye.asked).toHaveLength(BREAKER.failureThreshold + 1);

    eye.alive = true;
    clock.now += BREAKER.coolDownMs;
    expect(await chain.readWithSource(SKETCH)).toEqual({ source: "primary", reading: FROM_EYE });
    expect(await chain.readWithSource(SKETCH)).toEqual({ source: "primary", reading: FROM_EYE });
    expect(heard).toEqual([false, true]);
  });

  it("forgets earlier failures once the primary answers", async () => {
    const eye = new ScriptedEye();
    const chain = chainAt(eye, { now: 0 });
    for (const alive of [false, false, true, false, false, true]) {
      eye.alive = alive;
      await chain.read(SKETCH);
    }
    expect(eye.asked).toHaveLength(6);
  });

  it("does not trouble the primary with an empty sketch", async () => {
    const eye = new ScriptedEye();
    expect(await chainAt(eye, { now: 0 }).readWithSource([[]])).toEqual({
      source: "floor",
      reading: FROM_KNN,
    });
    expect(eye.asked).toHaveLength(0);
  });
});
