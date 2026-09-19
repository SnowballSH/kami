import { describe, expect, it } from "vitest";
import { distance, expandRect, rectContains, strokesLength } from "../core/geometry";
import { createHandwriting, type PenScript, type WriteOptions } from "./index";
import { EM_SHARE_OF_LINE_HEIGHT } from "./lineMetrics";
import { penSpeed } from "./timing";

const handwriting = createHandwriting();

const NOTE: WriteOptions = { origin: { x: 400, y: -250 }, size: 28, maxWidth: 360, seed: 7 };
const LINE = "Curiouser and curiouser! That is a mushroom, and mushrooms are bouncy.";

const write = (text: string, options: Partial<WriteOptions> = {}): PenScript =>
  handwriting.write(text, { ...NOTE, ...options });

const lineCount = (script: PenScript): number => Math.floor(script.bounds.height / NOTE.size) + 1;

const meanY = (script: PenScript): number => {
  const points = script.strokes.flat();
  return points.reduce((total, point) => total + point.y, 0) / points.length;
};

describe("write", () => {
  it("gives identical strokes for the same text and seed", () => {
    expect(write(LINE)).toEqual(write(LINE));
  });

  it("wobbles differently under another seed, but only a little", () => {
    const one = write(LINE, { seed: 1 });
    const two = write(LINE, { seed: 2 });
    expect(two.strokes).not.toEqual(one.strokes);
    expect(two.strokes.length).toBe(one.strokes.length);
    const drift = distance(one.strokes[0]?.[0] ?? NOTE.origin, two.strokes[0]?.[0] ?? NOTE.origin);
    expect(drift).toBeLessThan(NOTE.size * 0.25);
  });

  it("tells fractional seeds apart", () => {
    expect(write("kami", { seed: 0.25 }).strokes).not.toEqual(
      write("kami", { seed: 0.75 }).strokes,
    );
  });

  it("wraps at maxWidth", () => {
    const script = write(LINE);
    expect(lineCount(script)).toBeGreaterThan(1);
    expect(script.bounds.width).toBeLessThanOrEqual(NOTE.maxWidth + NOTE.size * 0.5);
    expect(lineCount(write(LINE, { maxWidth: 10_000 }))).toBe(1);
  });

  it("treats size as the line height: each line sits size below the one before", () => {
    const linesBelow = 10;
    const first = meanY(write("moon"));
    const last = meanY(write(`${"\n".repeat(linesBelow)}moon`));
    expect((last - first) / linesBelow).toBeCloseTo(NOTE.size, 0);
  });

  it("keeps every line inside its size-tall slot below the origin", () => {
    const script = write(LINE);
    const slack = NOTE.size * 0.1;
    expect(script.bounds.y).toBeGreaterThan(NOTE.origin.y - slack);
    expect(script.bounds.y + script.bounds.height).toBeLessThan(
      NOTE.origin.y + lineCount(script) * NOTE.size + slack,
    );
  });

  it("scales with size", () => {
    const small = write("moon", { maxWidth: 10_000 });
    const large = write("moon", { maxWidth: 10_000, size: NOTE.size * 3 });
    expect(large.bounds.width / small.bounds.width).toBeCloseTo(3, 0);
    expect(large.bounds.height).toBeLessThan(NOTE.size * 3);
  });

  it("reports tight bounds that start at the origin", () => {
    const script = write(LINE);
    const points = script.strokes.flat();
    const slack = expandRect(script.bounds, 1e-9);
    expect(points.every((point) => rectContains(slack, point))).toBe(true);
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(script.bounds.x, 9);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(
      script.bounds.y + script.bounds.height,
      9,
    );
    expect(Math.abs(script.bounds.x - NOTE.origin.x)).toBeLessThan(NOTE.size / 2);
    expect(script.bounds.y).toBeGreaterThan(NOTE.origin.y - NOTE.size * 0.25);
    expect(script.bounds.y).toBeLessThan(NOTE.origin.y + NOTE.size);
  });

  it("gives empty text an empty rect at the origin and no time at all", () => {
    for (const text of ["", "   ", "\n"]) {
      const script = write(text);
      expect(script.strokes).toEqual([]);
      expect(script.durationMs).toBe(0);
      expect(script.bounds).toEqual({ ...NOTE.origin, width: 0, height: 0 });
    }
  });

  it("writes ? for characters it has no glyph for", () => {
    expect(write("g = 月").strokes).toEqual(write("g = ?").strokes);
    expect(write("g = 月").text).toBe("g = 月");
  });

  it("gives long segments points for the wobble to bend", () => {
    const script = write("| _ /", { size: 60 });
    const longest = Math.max(
      ...script.strokes.flatMap((stroke) =>
        stroke.slice(1).map((point, i) => distance(stroke[i] ?? point, point)),
      ),
    );
    expect(longest).toBeLessThan(60 * 0.25);
  });
});

describe("timing", () => {
  const script = write(LINE);

  it("has one window per stroke, in order and never overlapping", () => {
    expect(script.startsAtMs).toHaveLength(script.strokes.length);
    expect(script.endsAtMs).toHaveLength(script.strokes.length);
    expect(script.startsAtMs[0]).toBe(0);
    script.strokes.forEach((_, i) => {
      const start = script.startsAtMs[i] ?? Number.NaN;
      const end = script.endsAtMs[i] ?? Number.NaN;
      expect(end).toBeGreaterThan(start);
      expect(start).toBeGreaterThanOrEqual(script.endsAtMs[i - 1] ?? 0);
    });
    expect(script.durationMs).toBe(script.endsAtMs.at(-1));
  });

  it("moves the pen at a steady speed, plus lifts", () => {
    const drawingMs = strokesLength(script.strokes) / penSpeed(NOTE.size * EM_SHARE_OF_LINE_HEIGHT);
    expect(script.durationMs).toBeGreaterThan(drawingMs);
    expect(script.durationMs).toBeLessThan(drawingMs * 3);
  });

  it("pauses longer between words than within one, and longest between lines", () => {
    const gaps = (text: string): number[] => {
      const { startsAtMs, endsAtMs } = write(text, { maxWidth: 10_000 });
      return startsAtMs.slice(1).map((start, i) => start - (endsAtMs[i] ?? start));
    };
    const [withinWord = 0] = gaps("ll");
    const [betweenWords = 0] = gaps("l l");
    const [betweenLines = 0] = gaps("l\nl");
    expect(withinWord).toBeGreaterThan(0);
    expect(betweenWords).toBeGreaterThan(withinWord);
    expect(betweenLines).toBeGreaterThan(betweenWords);
  });

  it("takes about as long at any size", () => {
    const large = write(LINE, { size: NOTE.size * 2, maxWidth: NOTE.maxWidth * 2 });
    expect(large.durationMs / script.durationMs).toBeCloseTo(1, 1);
  });
});
