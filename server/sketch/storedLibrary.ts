import { QUICKDRAW_CATEGORIES } from "../quickdraw/categories";
import { type SimplifiedStroke, toStrokes } from "../quickdraw/dataset";
import type { StoredSketch } from "../quickdraw/sampleRepository";
import type { Sketch, SketchLibrary } from "./types";

export interface SketchStore {
  anyOf(category: string): Promise<StoredSketch | null>;
}

const FRAME = 256;

const inFrame = (coordinate: number): boolean =>
  Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= FRAME;

const wellFormed = (drawing: readonly SimplifiedStroke[]): boolean =>
  drawing.length > 0 &&
  drawing.every(
    ([xs, ys]) =>
      xs.length > 1 && xs.length === ys.length && xs.every(inFrame) && ys.every(inFrame),
  );

/** The k-NN's ingested Quick, Draw! samples (`bun run quickdraw:ingest`), a random one each time. */
export class StoredLibrary implements SketchLibrary {
  readonly categories: readonly string[] = QUICKDRAW_CATEGORIES;

  constructor(private readonly store: SketchStore) {}

  async pick(category: string): Promise<Sketch | null> {
    const stored = await this.store.anyOf(category);
    if (stored === null || !wellFormed(stored.drawing)) return null;
    return { category, strokes: toStrokes(stored.drawing) };
  }

  describe(): string {
    return `summoning: ingested Quick, Draw! samples of ${this.categories.length} categories`;
  }
}

/** Each library in turn, the first with a drawing of the category wins. */
export class FirstAnswering implements SketchLibrary {
  readonly categories: readonly string[];

  constructor(private readonly libraries: readonly SketchLibrary[]) {
    this.categories = [...new Set(libraries.flatMap((library) => library.categories))];
  }

  async pick(category: string): Promise<Sketch | null> {
    for (const library of this.libraries) {
      const sketch = await library.pick(category);
      if (sketch !== null) return sketch;
    }
    return null;
  }

  describe(): string {
    return this.libraries.map((library) => library.describe()).join(", then ");
  }
}
