import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FONT_CHARACTERS,
  serializeStrokeFont,
  toStrokeFontData,
} from "../../../scripts/strokeFont/convert";
import { KAMI_GLYPHS } from "../../../scripts/strokeFont/kamiGlyphs";
import { CUBIC_SEGMENTS, parsePathData } from "../../../scripts/strokeFont/pathData";
import { decodeXmlEntities, parseSvgFont } from "../../../scripts/strokeFont/svgFont";
import type { StrokeFontData } from "../fontData";

const SVG_SOURCE = "../../../node_modules/hersheytext/svg_fonts/EMSReadability.svg";

const read = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const onDisk = read("./emsReadability.json");
const font: StrokeFontData = JSON.parse(onDisk);
const svgFont = parseSvgFont(read(SVG_SOURCE));

const printableAscii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
  String.fromCodePoint(0x20 + i),
);

describe("path data", () => {
  it("reads commands with or without separating spaces, and exponents", () => {
    expect(parsePathData("M 1 2 L 3 4 M5 -6L7.5 2.84e-14")).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, -6],
        [7.5, 2.84e-14],
      ],
    ]);
  });

  it("flattens a cubic into a handful of segments that end on its end point", () => {
    const [polyline = []] = parsePathData("M0 0C0 10 10 10 10 0");
    expect(polyline).toHaveLength(1 + CUBIC_SEGMENTS);
    expect(polyline.at(-1)).toEqual([10, 0]);
    expect(polyline[CUBIC_SEGMENTS / 2]).toEqual([5, 7.5]);
  });

  it("refuses commands it cannot draw", () => {
    expect(() => parsePathData("M 0 0 Q 1 1 2 2")).toThrow();
  });
});

describe("the svg font", () => {
  it("decodes xml entities in unicode attributes", () => {
    expect(decodeXmlEntities("&amp;&#x22;&apos;&#8212;")).toBe("&\"'—");
    expect(svgFont.glyphs.map((glyph) => glyph.unicode)).toEqual(
      expect.arrayContaining(["&", '"', "'", "<", ">", "—"]),
    );
  });

  it("carries the licence in its metadata", () => {
    expect(svgFont.metadata.get("License")).toContain("SIL Open Font License");
  });
});

describe("emsReadability.json", () => {
  it("is exactly what the build script produces", () => {
    expect(onDisk).toBe(serializeStrokeFont(toStrokeFontData(svgFont, KAMI_GLYPHS)));
  });

  it("stays small", () => {
    expect(onDisk.length).toBeLessThan(100_000);
  });

  it("has a glyph for every printable ASCII character", () => {
    expect(printableAscii.filter((character) => !(character in font.glyphs))).toEqual([]);
    expect(FONT_CHARACTERS).toEqual(expect.arrayContaining(printableAscii));
  });

  it("draws every glyph but the space, in integers around the baseline", () => {
    for (const [character, glyph] of Object.entries(font.glyphs)) {
      expect(glyph.advance).toBeGreaterThan(0);
      expect(glyph.strokes.length > 0).toBe(character !== " ");
      expect(glyph.strokes.flat().every(Number.isInteger)).toBe(true);
    }
  });

  it('spot check: "a" sits on the baseline and "g" hangs below it', () => {
    const lowestY = (character: string): number =>
      Math.max(
        ...(font.glyphs[character]?.strokes ?? []).flatMap((stroke) =>
          stroke.filter((_, i) => i % 2 === 1),
        ),
      );
    expect(font.glyphs.a?.strokes.length).toBeGreaterThanOrEqual(1);
    expect(font.glyphs.a?.advance).toBeGreaterThan(0);
    expect(Math.abs(lowestY("a"))).toBeLessThan(40);
    expect(lowestY("g")).toBeGreaterThan(100);
  });
});
