import { describe, expect, it } from "vitest";
import { type Stroke, strokeLength } from "../core/geometry";
import { createHandwriting } from "./index";
import { cutAtLength } from "./reveal";

const handwriting = createHandwriting();
const script = handwriting.write("no gravity, said the Cat", {
  origin: { x: 0, y: 0 },
  size: 32,
  maxWidth: 300,
  seed: 11,
});

const IN_PROGRESS = 5;
const windowOf = (index: number): { start: number; end: number } => ({
  start: script.startsAtMs[index] ?? Number.NaN,
  end: script.endsAtMs[index] ?? Number.NaN,
});

describe("reveal", () => {
  it("shows nothing before the pen touches down", () => {
    expect(handwriting.reveal(script, 0)).toEqual([]);
    expect(handwriting.reveal(script, -500)).toEqual([]);
  });

  it("hands back the script's own strokes once writing is done", () => {
    expect(handwriting.reveal(script, script.durationMs)).toBe(script.strokes);
    expect(handwriting.reveal(script, script.durationMs + 10_000)).toBe(script.strokes);
  });

  it("keeps finished strokes whole, cuts the one in progress, omits the rest", () => {
    const { start, end } = windowOf(IN_PROGRESS);
    const fraction = 0.4;
    const revealed = handwriting.reveal(script, start + (end - start) * fraction);
    expect(revealed).toHaveLength(IN_PROGRESS + 1);
    revealed.slice(0, IN_PROGRESS).forEach((stroke, i) => {
      expect(stroke).toBe(script.strokes[i]);
    });
    const full = script.strokes[IN_PROGRESS] ?? [];
    const partial = revealed[IN_PROGRESS] ?? [];
    expect(strokeLength(partial)).toBeCloseTo(strokeLength(full) * fraction, 6);
    expect(partial[0]).toBe(full[0]);
  });

  it("shows only finished strokes while the pen is lifted", () => {
    const { end } = windowOf(IN_PROGRESS);
    const next = windowOf(IN_PROGRESS + 1);
    const revealed = handwriting.reveal(script, (end + next.start) / 2);
    expect(revealed).toHaveLength(IN_PROGRESS + 1);
    expect(revealed.at(-1)).toBe(script.strokes[IN_PROGRESS]);
  });

  it("grows steadily", () => {
    const lengths = Array.from({ length: 50 }, (_, i) =>
      handwriting
        .reveal(script, (script.durationMs * i) / 49)
        .reduce((total, stroke) => total + strokeLength(stroke), 0),
    );
    lengths.slice(1).forEach((length, i) => {
      expect(length).toBeGreaterThanOrEqual(lengths[i] ?? 0);
    });
  });
});

describe("cutAtLength", () => {
  const corner: Stroke = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("ends on an interpolated point", () => {
    expect(cutAtLength(corner, 15)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("is a dot at zero and the whole stroke past its end", () => {
    expect(cutAtLength(corner, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(cutAtLength(corner, 99)).toEqual(corner);
  });
});
