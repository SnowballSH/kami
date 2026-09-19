/** One stroke as a flat `[x, y, x, y, …]` list in font units, y-down, 0 at the baseline. */
export type FlatStroke = readonly number[];

export interface GlyphData {
  readonly advance: number;
  readonly strokes: readonly FlatStroke[];
}

/** The shape of `fonts/*.json`, written by `scripts/buildStrokeFont.ts`. */
export interface StrokeFontData {
  readonly name: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly glyphs: Readonly<Record<string, GlyphData>>;
}
