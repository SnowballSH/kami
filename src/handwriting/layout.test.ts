import { describe, expect, it } from "vitest";
import type { StrokeFontData } from "./fontData";
import { type LaidOutLine, layOutText } from "./layout";
import { StrokeFont } from "./strokeFont";

const ADVANCE = 100;
const DASH = [[0, 0, 80, 0]];

const monospace: StrokeFontData = {
  name: "test mono",
  unitsPerEm: 1000,
  ascent: 800,
  descent: 200,
  glyphs: {
    " ": { advance: ADVANCE, strokes: [] },
    "?": { advance: ADVANCE, strokes: [[0, 0, 40, -80]] },
    "'": { advance: ADVANCE, strokes: [[40, -80, 40, -60]] },
    ".": { advance: ADVANCE, strokes: [[40, 0, 41, 0]] },
    a: { advance: ADVANCE, strokes: DASH },
    b: { advance: ADVANCE, strokes: DASH },
    e: { advance: ADVANCE, strokes: DASH },
  },
};

const font = new StrokeFont(monospace);

const lineWidth = (line: LaidOutLine): number => {
  const last = line.at(-1)?.at(-1);
  return last === undefined ? 0 : last.x + last.glyph.advance;
};

const glyphCounts = (lines: readonly LaidOutLine[]): number[][] =>
  lines.map((line) => line.map((word) => word.length));

describe("layOutText", () => {
  it("wraps greedily at word boundaries", () => {
    const lines = layOutText("aa bb aaa b", font, 5 * ADVANCE);
    expect(glyphCounts(lines)).toEqual([
      [2, 2],
      [3, 1],
    ]);
    expect(lines.map(lineWidth)).toEqual([5 * ADVANCE, 5 * ADVANCE]);
  });

  it("places each word one space after the last", () => {
    const [line = []] = layOutText("ab  \t a", font, Number.POSITIVE_INFINITY);
    expect(line.map((word) => word.map((placed) => placed.x))).toEqual([[0, 100], [300]]);
  });

  it("breaks a word that is wider than the line", () => {
    const lines = layOutText("aaaaaaa", font, 3 * ADVANCE);
    expect(glyphCounts(lines)).toEqual([[3], [3], [1]]);
  });

  it("keeps explicit and blank lines", () => {
    expect(glyphCounts(layOutText("a\n\nb", font, 1000))).toEqual([[1], [], [1]]);
  });

  it("falls back to ? for characters the font cannot write, one per character", () => {
    const [line = []] = layOutText("a紙🙂한", font, Number.POSITIVE_INFINITY);
    const fallback = font.glyphFor("?");
    expect(line.flat().map((placed) => placed.glyph === fallback)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it("respells typographic characters and drops accents rather than giving up", () => {
    const [line = []] = layOutText("é’…", font, Number.POSITIVE_INFINITY);
    expect(line.flat().map((placed) => placed.glyph)).toEqual(
      ["e", "'", ".", ".", "."].map((character) => font.glyphFor(character)),
    );
  });
});
