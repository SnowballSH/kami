import type { Stroke, Vec } from "../core/geometry";
import type { SketchLibrary } from "../persistence/types";
import { parseWish, type Wish } from "./grammar";
import { fitSketch, layoutBoxes, sizeOf } from "./layout";
import { SummoningLexicon } from "./lexicon";

export interface Summoned {
  readonly category: string;
  readonly strokes: readonly Stroke[];
}

/**
 * Turns written wishes into drawings from the sketch library: the library's categories make the
 * lexicon (fetched once), a wish names some of them, and each is drawn to size in a row below
 * where the wish was written.
 */
export class Summoner {
  #lexicon: Promise<SummoningLexicon> | null = null;

  constructor(private readonly library: SketchLibrary) {}

  /** Fetch the catalogue ahead of the first wish. */
  wake(): void {
    void this.lexicon();
  }

  async wish(text: string): Promise<Wish | null> {
    return parseWish(text, await this.lexicon());
  }

  async conjure(wish: Wish, origin: Vec): Promise<readonly Summoned[]> {
    const categories = wish.summons.flatMap(({ category, count }) =>
      Array.from({ length: count }, () => category),
    );
    const sketches = await Promise.all(categories.map((category) => this.library.sketch(category)));
    const drawn = categories.flatMap((category, index) => {
      const sketch = sketches[index] ?? null;
      return sketch === null || sketch.length === 0 ? [] : [{ category, sketch }];
    });
    const boxes = layoutBoxes(
      drawn.map(({ category }) => sizeOf(category)),
      origin,
    );
    return drawn.flatMap(({ category, sketch }, index) => {
      const box = boxes[index];
      return box === undefined ? [] : [{ category, strokes: fitSketch(sketch, box) }];
    });
  }

  /** Kept once the library answered; an empty catalogue (the server was away) is asked again. */
  private lexicon(): Promise<SummoningLexicon> {
    this.#lexicon ??= this.library.categories().then((categories) => {
      if (categories.length === 0) this.#lexicon = null;
      return new SummoningLexicon(categories);
    });
    return this.#lexicon;
  }
}
