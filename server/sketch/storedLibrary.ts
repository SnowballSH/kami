import { QUICKDRAW_CATEGORIES } from "../quickdraw/categories";
import { isWellFormedDrawing, toStrokes } from "../quickdraw/dataset";
import type { StoredSketch } from "../quickdraw/snapshotFile";
import type { Sketch, SketchLibrary } from "./types";

export interface SketchStore {
  anyOf(category: string): Promise<StoredSketch | null>;
}

/** The most typical drawings of the k-NN's Quick, Draw! corpus (`bun run quickdraw:ingest`), a random one each time. */
export class StoredLibrary implements SketchLibrary {
  readonly categories: readonly string[] = QUICKDRAW_CATEGORIES;

  constructor(private readonly store: SketchStore) {}

  async pick(category: string): Promise<Sketch | null> {
    const stored = await this.store.anyOf(category);
    if (stored === null || !isWellFormedDrawing(stored.drawing)) return null;
    return { category, strokes: toStrokes(stored.drawing) };
  }

  describe(): string {
    return `summoning: the Quick, Draw! corpus, ${this.categories.length} categories`;
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
