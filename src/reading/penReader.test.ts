import { describe, expect, it } from "vitest";
import type { Stroke } from "../core/geometry";
import type { HandwritingReader, ReadOptions } from "../persistence/types";
import { couldBeWriting } from "./gate";
import { PrefixPenReader } from "./penReader";

interface Asked {
  readonly strokes: readonly Stroke[];
  readonly signal: AbortSignal | undefined;
  answer(text: string | null): void;
}

/** A reader that answers only when the test says so. */
class SlowReader implements HandwritingReader {
  readonly asked: Asked[] = [];

  read(strokes: readonly Stroke[], { signal }: ReadOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
      this.asked.push({ strokes, signal, answer: resolve });
      signal?.addEventListener("abort", () => resolve(null));
    });
  }
}

const stroke = (x: number, ...ys: number[]): Stroke => ys.map((y) => ({ x, y }));

const H = stroke(0, 0, 10);
const BAR = stroke(0, 5).concat(stroke(20, 5));
const I = stroke(20, 0, 10);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const settled = async <T>(promise: Promise<T>): Promise<T | "pending"> =>
  Promise.race([promise, flush().then(() => "pending" as const)]);

describe("couldBeWriting", () => {
  it("rules out a lone straight line and tall drawings", () => {
    expect(couldBeWriting([])).toBe(false);
    expect(couldBeWriting([stroke(0, 0, 100)])).toBe(false);
    expect(couldBeWriting([[{ x: 0, y: 0 }]])).toBe(false);
    expect(couldBeWriting([H, I])).toBe(true);
    expect(couldBeWriting([stroke(0, 0, 400), stroke(10, 0, 400)])).toBe(false);
    const squiggle: Stroke = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: (i % 2) * 30 }));
    expect(couldBeWriting([squiggle])).toBe(true);
  });

  it.each([
    [20, false],
    [40, false],
    [51, false],
    [52, true],
    [80, true],
  ] as const)("requires enough horizontal space for writing at width %s", (width, expected) => {
    expect(couldBeWriting([stroke(0, 0, 40), stroke(width, 0, 40)])).toBe(expected);
  });
});

describe("PrefixPenReader", () => {
  it("does not send compact doodles to the reader at pen lifts or settlement", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    const doodle = [stroke(0, 0, 40), stroke(20, 0, 40), stroke(40, 0, 40)];
    for (let count = 1; count <= doodle.length; count += 1) {
      pen.glimpse(doodle.slice(0, count));
    }
    expect(await pen.settle(doodle)).toBeNull();
    expect(reader.asked).toHaveLength(0);
  });

  it("reads at every pen-lift, dropping the read of the strokes before", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    pen.glimpse([H]);
    expect(reader.asked).toHaveLength(0);
    pen.glimpse([H, I]);
    pen.glimpse([H, I, BAR]);
    expect(reader.asked).toHaveLength(2);
    expect(reader.asked[0]?.signal?.aborted).toBe(true);
    expect(reader.asked[1]?.signal?.aborted).toBe(false);
    expect(reader.asked[1]?.strokes).toHaveLength(3);
  });

  it("does not ask twice about the same strokes", () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    pen.glimpse([H, I]);
    pen.glimpse([H, I]);
    expect(reader.asked).toHaveLength(1);
  });

  it("settles on an answer already in, or waits for the one in flight", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    pen.glimpse([H, I]);
    expect(pen.recall([H, I])).toBeUndefined();
    reader.asked[0]?.answer("hi");
    await flush();
    expect(pen.recall([H, I])).toBe("hi");
    expect(await pen.settle([H, I])).toBe("hi");

    pen.glimpse([H, BAR]);
    const reading = pen.settle([H, BAR]);
    expect(await settled(reading)).toBe("pending");
    reader.asked[1]?.answer("hi again");
    expect(await reading).toBe("hi again");
    expect(reader.asked).toHaveLength(2);
  });

  it("never trusts a reading of different strokes", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    pen.glimpse([H, I]);
    reader.asked[0]?.answer("hi");
    await flush();
    expect(pen.recall([H, I, BAR])).toBeUndefined();
    const reading = pen.settle([H, I, BAR]);
    expect(reader.asked).toHaveLength(2);
    reader.asked[1]?.answer(null);
    expect(await reading).toBeNull();
  });

  it("knows a platform is not a word without asking", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    const platform = stroke(0, 0).concat(stroke(300, 0));
    pen.glimpse([platform]);
    expect(pen.recall([platform])).toBeNull();
    expect(await pen.settle([platform])).toBeNull();
    expect(reader.asked).toHaveLength(0);
  });

  it("drops a read still in flight when the finished drawing is plainly not writing", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    pen.glimpse([H, BAR]);
    const tall = [H, BAR, stroke(40, 0, 400)];
    expect(await pen.settle(tall)).toBeNull();
    expect(reader.asked).toHaveLength(1);
    expect(reader.asked[0]?.signal?.aborted).toBe(true);
  });

  it("forgets everything when the strokes are dropped", async () => {
    const reader = new SlowReader();
    const pen = new PrefixPenReader(reader);
    pen.glimpse([H, I]);
    pen.forget();
    expect(reader.asked[0]?.signal?.aborted).toBe(true);
    pen.glimpse([H, I]);
    expect(reader.asked).toHaveLength(2);
  });
});
