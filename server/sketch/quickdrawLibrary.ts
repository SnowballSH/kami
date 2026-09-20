import { QUICKDRAW_CATEGORIES } from "../quickdraw/categories";
import { type FetchLike, fetchCategoryDrawings, toStrokes } from "../quickdraw/dataset";
import type { Sketch, SketchLibrary } from "./types";

const DRAWINGS_PER_CATEGORY = 32;

/**
 * Without an exemplar set, summoned drawings come straight from Quick, Draw!: the first recognised
 * drawings of each curated category, fetched on first request and kept.
 */
export class QuickdrawLibrary implements SketchLibrary {
  readonly categories: readonly string[] = QUICKDRAW_CATEGORIES;
  private readonly cache = new Map<string, Promise<readonly Sketch[]>>();

  constructor(
    private readonly fetchFn: FetchLike = fetch,
    private readonly random: () => number = Math.random,
  ) {}

  async pick(category: string): Promise<Sketch | null> {
    if (!this.categories.includes(category)) return null;
    const sketches = await this.sketchesOf(category);
    return sketches[Math.floor(this.random() * sketches.length)] ?? null;
  }

  describe(): string {
    return `summoning: Quick, Draw! itself, ${this.categories.length} categories (no exemplar set)`;
  }

  private sketchesOf(category: string): Promise<readonly Sketch[]> {
    const cached = this.cache.get(category);
    if (cached !== undefined) return cached;
    const loading = fetchCategoryDrawings(category, DRAWINGS_PER_CATEGORY, this.fetchFn)
      .then((drawings) =>
        drawings
          .map(({ drawing }) => ({ category, strokes: toStrokes(drawing) }))
          .filter(({ strokes }) => strokes.length > 0),
      )
      .catch((): readonly Sketch[] => {
        this.cache.delete(category);
        return [];
      });
    this.cache.set(category, loading);
    return loading;
  }
}
