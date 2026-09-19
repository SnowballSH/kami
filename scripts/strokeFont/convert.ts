import type { FlatStroke, GlyphData, StrokeFontData } from "../../src/handwriting/fontData";
import { type Polyline, parsePathData } from "./pathData";
import type { SvgFont, SvgGlyph } from "./svgFont";

const FIRST_PRINTABLE_ASCII = 0x20;
const LAST_PRINTABLE_ASCII = 0x7e;
const WHITEBOARD_PUNCTUATION = "–—“”×÷°·²³½";

export const FONT_CHARACTERS: readonly string[] = [
  ...Array.from({ length: LAST_PRINTABLE_ASCII - FIRST_PRINTABLE_ASCII + 1 }, (_, i) =>
    String.fromCodePoint(FIRST_PRINTABLE_ASCII + i),
  ),
  ...WHITEBOARD_PUNCTUATION,
];

const flattenYDown = (polyline: Polyline): FlatStroke => {
  const points = polyline.map(([x, y]) => [Math.round(x), Math.round(-y)] as const);
  return points
    .filter(([x, y], i) => {
      const previous = points[i - 1];
      return previous === undefined || previous[0] !== x || previous[1] !== y;
    })
    .flat();
};

const toGlyphData = (glyph: SvgGlyph): GlyphData => ({
  advance: Math.round(glyph.advance),
  strokes: parsePathData(glyph.pathData).map(flattenYDown),
});

/** The font's whiteboard subset, then `additions`: glyphs the font lacks, drawn for this project. */
export const toStrokeFontData = (
  font: SvgFont,
  additions: readonly SvgGlyph[] = [],
): StrokeFontData => {
  const byCharacter = new Map(font.glyphs.map((glyph) => [glyph.unicode, glyph]));
  const subset = FONT_CHARACTERS.map((character) => {
    const glyph = byCharacter.get(character);
    if (glyph === undefined) throw new Error(`${font.family} has no glyph for "${character}"`);
    return glyph;
  });
  return {
    name: font.family,
    unitsPerEm: font.unitsPerEm,
    ascent: Math.abs(font.ascent),
    descent: Math.abs(font.descent),
    glyphs: Object.fromEntries(
      [...subset, ...additions].map((glyph) => [glyph.unicode, toGlyphData(glyph)]),
    ),
  };
};

export const serializeStrokeFont = (font: StrokeFontData): string => {
  const { glyphs, ...metrics } = font;
  const metricLines = Object.entries(metrics).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  );
  const glyphLines = Object.entries(glyphs).map(
    ([character, glyph]) => `    ${JSON.stringify(character)}: ${JSON.stringify(glyph)}`,
  );
  return ["{", ...metricLines, '  "glyphs": {', glyphLines.join(",\n"), "  }", "}", ""].join("\n");
};
