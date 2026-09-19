import type { Glyph, StrokeFont } from "./strokeFont";

/** A glyph and where its pen starts, in font units from the left end of its line. */
export interface PlacedGlyph {
  readonly glyph: Glyph;
  readonly x: number;
}

export type LaidOutWord = readonly PlacedGlyph[];
export type LaidOutLine = readonly LaidOutWord[];

const LINE_BREAK = /\r?\n/;
const WHITESPACE = /\s+/;
const COMBINING_MARK = /^\p{M}$/u;

const SUBSTITUTES: ReadonlyMap<string, string> = new Map([
  ["‘", "'"],
  ["’", "'"],
  ["…", "..."],
  ["−", "-"],
  ["→", "->"],
  ["←", "<-"],
  ["≈", "~"],
  ["≤", "<="],
  ["≥", ">="],
]);

const spell = (character: string, font: StrokeFont): string[] => {
  if (font.has(character)) return [character];
  const substitute = SUBSTITUTES.get(character);
  if (substitute !== undefined) return Array.from(substitute);
  const [unaccented = character] = Array.from(character.normalize("NFD"));
  return [unaccented];
};

const glyphsOf = (word: string, font: StrokeFont): Glyph[] =>
  Array.from(word)
    .filter((character) => !COMBINING_MARK.test(character))
    .flatMap((character) => spell(character, font))
    .map((character) => font.glyphFor(character));

const splitToFit = (glyphs: readonly Glyph[], maxWidth: number): Glyph[][] => {
  const pieces: Glyph[][] = [];
  let piece: Glyph[] = [];
  let width = 0;
  for (const glyph of glyphs) {
    if (piece.length > 0 && width + glyph.advance > maxWidth) {
      pieces.push(piece);
      piece = [];
      width = 0;
    }
    piece.push(glyph);
    width += glyph.advance;
  }
  return piece.length > 0 ? [...pieces, piece] : pieces;
};

class LineFiller {
  readonly #spaceAdvance: number;
  readonly #maxWidth: number;
  readonly #lines: LaidOutWord[][] = [];
  #line: LaidOutWord[] = [];
  #cursor = 0;

  constructor(spaceAdvance: number, maxWidth: number) {
    this.#spaceAdvance = spaceAdvance;
    this.#maxWidth = maxWidth;
  }

  add(word: readonly Glyph[]): void {
    const width = word.reduce((total, glyph) => total + glyph.advance, 0);
    if (this.#line.length > 0 && this.#cursor + this.#spaceAdvance + width > this.#maxWidth) {
      this.#breakLine();
    }
    let x = this.#line.length > 0 ? this.#cursor + this.#spaceAdvance : 0;
    const placed = word.map((glyph) => {
      const start = x;
      x += glyph.advance;
      return { glyph, x: start };
    });
    this.#line.push(placed);
    this.#cursor = x;
  }

  finish(): LaidOutLine[] {
    this.#breakLine();
    return this.#lines;
  }

  #breakLine(): void {
    this.#lines.push(this.#line);
    this.#line = [];
    this.#cursor = 0;
  }
}

const wrapParagraph = (paragraph: string, font: StrokeFont, maxWidth: number): LaidOutLine[] => {
  const filler = new LineFiller(font.spaceAdvance, maxWidth);
  paragraph
    .split(WHITESPACE)
    .filter((word) => word !== "")
    .flatMap((word) => splitToFit(glyphsOf(word, font), maxWidth))
    .forEach((word) => {
      filler.add(word);
    });
  return filler.finish();
};

/** Greedy word wrap on glyph advances; `maxWidth` is in font units. A blank line stays blank. */
export const layOutText = (
  text: string,
  font: StrokeFont,
  maxWidth: number,
): readonly LaidOutLine[] =>
  text
    .normalize("NFC")
    .split(LINE_BREAK)
    .flatMap((paragraph) => wrapParagraph(paragraph, font, maxWidth));
