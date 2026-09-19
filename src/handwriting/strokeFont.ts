import type { Stroke, Vec } from "../core/geometry";
import type { FlatStroke, StrokeFontData } from "./fontData";
import emsFelixData from "./fonts/emsFelix.json";

const FALLBACK_CHARACTER = "?";
const SPACE = " ";
const EMS_FELIX_TRACKING = 30;

/** A glyph in font units, y-down, with the baseline at y = 0 and the pen starting at x = 0. */
export interface Glyph {
  readonly advance: number;
  readonly strokes: readonly Stroke[];
}

const toStroke = (flat: FlatStroke): Stroke =>
  Array.from({ length: Math.floor(flat.length / 2) }, (_, i): Vec => {
    const [x = 0, y = 0] = flat.slice(i * 2, i * 2 + 2);
    return { x, y };
  });

export class StrokeFont {
  readonly name: string;
  readonly ascent: number;
  readonly emHeight: number;
  readonly #glyphs: ReadonlyMap<string, Glyph>;
  readonly #fallback: Glyph;

  constructor(data: StrokeFontData, tracking = 0) {
    this.name = data.name;
    this.ascent = data.ascent;
    this.emHeight = data.ascent + data.descent;
    this.#glyphs = new Map(
      Object.entries(data.glyphs).map(([character, glyph]) => [
        character,
        { advance: glyph.advance + tracking, strokes: glyph.strokes.map(toStroke) },
      ]),
    );
    const fallback = this.#glyphs.get(FALLBACK_CHARACTER);
    if (fallback === undefined) throw new Error(`${data.name} has no "${FALLBACK_CHARACTER}"`);
    this.#fallback = fallback;
  }

  get spaceAdvance(): number {
    return this.glyphFor(SPACE).advance;
  }

  has(character: string): boolean {
    return this.#glyphs.has(character);
  }

  glyphFor(character: string): Glyph {
    return this.#glyphs.get(character) ?? this.#fallback;
  }
}

export const loadEmsFelix = (): StrokeFont => new StrokeFont(emsFelixData, EMS_FELIX_TRACKING);
