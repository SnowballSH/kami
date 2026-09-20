import type { Stroke } from "../../src/core/geometry";

/** A clean drawing of a category, in Quick, Draw!'s 0–255 simplified space. */
export interface Sketch {
  readonly category: string;
  readonly strokes: readonly Stroke[];
}

/** Clean drawings to summon by name: the exemplar set of the Eye, or Quick, Draw! itself. */
export interface SketchLibrary {
  readonly categories: readonly string[];
  /** A different good drawing each time; null for a category the library does not have. */
  pick(category: string): Promise<Sketch | null>;
  describe(): string;
}
