import type { Rect, Stroke } from "../core/geometry";
import type { Exemplar } from "../recognition";
import { parseWish, type Wish } from "./grammar";
import { fitSketch, layoutBoxes, sizeOf, standOver } from "./layout";
import { SummoningLexicon } from "./lexicon";

/** The words there are pictures of (`GET /api/exemplars`); empty when the server is away. */
export interface SketchCatalogue {
  categories(): Promise<readonly string[]>;
}

/** Where a picture of a word comes from (`GET /api/exemplar?word=…`); null without one. */
export interface PictureSource {
  exemplar(word: string): Promise<Exemplar | null>;
}

export interface Summoned {
  /** The Quick, Draw! word it is a drawing of, which the game names it by. */
  readonly word: string;
  readonly strokes: readonly Stroke[];
}

/**
 * Turns written wishes into drawings: the catalogue makes the lexicon (fetched once), a wish names
 * some of its words, and a picture of each is drawn to size in rows standing over the words that
 * asked for them.
 */
export class Summoner {
  #lexicon: Promise<SummoningLexicon> | null = null;

  constructor(
    private readonly catalogue: SketchCatalogue,
    private readonly pictures: PictureSource,
  ) {}

  /** Fetch the catalogue ahead of the first wish. */
  wake(): void {
    void this.lexicon();
  }

  async wish(text: string): Promise<Wish | null> {
    return parseWish(text, await this.lexicon());
  }

  async conjure(wish: Wish, writing: Rect, alice: Rect | null): Promise<readonly Summoned[]> {
    const words = wish.summons.flatMap(({ category, count }) =>
      Array.from({ length: count }, () => category),
    );
    const pictures = await Promise.all(words.map((word) => this.pictures.exemplar(word)));
    const drawn = pictures.flatMap((picture) =>
      picture === null || picture.strokes.length === 0 ? [] : [picture],
    );
    const boxes = layoutBoxes(
      drawn.map(({ word }) => sizeOf(word)),
      { x: 0, y: 0 },
    );
    const fitted = drawn.flatMap(({ strokes }, index) => {
      const box = boxes[index];
      return box === undefined ? [] : [fitSketch(strokes, box)];
    });
    const placed = standOver(fitted, writing, alice);
    return drawn.flatMap(({ word }, index) => {
      const strokes = placed[index];
      return strokes === undefined ? [] : [{ word, strokes }];
    });
  }

  /** Kept once the catalogue answered; an empty one (the server was away) is asked again. */
  private lexicon(): Promise<SummoningLexicon> {
    this.#lexicon ??= this.catalogue.categories().then((categories) => {
      if (categories.length === 0) this.#lexicon = null;
      return new SummoningLexicon(categories);
    });
    return this.#lexicon;
  }
}
