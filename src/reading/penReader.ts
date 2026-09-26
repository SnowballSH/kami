import { type Stroke, strokesLength } from "../core/geometry";
import type { Handwriting, HandwritingReader } from "../persistence/types";
import { couldBeWriting } from "./gate";
import type { PenReader } from "./types";

interface Attempt {
  readonly key: string;
  readonly controller: AbortController;
  readonly reading: Promise<Handwriting | null>;
}

interface Reading {
  readonly key: string;
  readonly handwriting: Handwriting | null;
}

/**
 * Every pen-lift starts a read of everything drawn so far and cancels the one before it (only the
 * newest strokes can be the final ones), so when the ink settles ~a second after the last lift
 * the answer for exactly those strokes is usually already in, or about to be. When the reader
 * was unsure of the final strokes, they are read once more as settled, which the server may
 * spend longer on.
 */
export class PrefixPenReader implements PenReader {
  readonly #reader: HandwritingReader;
  #generation = 0;
  #attempt: Attempt | null = null;
  #last: Reading | null = null;

  constructor(reader: HandwritingReader) {
    this.#reader = reader;
  }

  glimpse(strokes: readonly Stroke[]): void {
    if (!couldBeWriting(strokes)) return;
    const key = this.#keyOf(strokes);
    if (this.#attempt?.key === key || this.#last?.key === key) return;
    this.#begin(key, strokes);
  }

  recall(strokes: readonly Stroke[]): string | null | undefined {
    const key = this.#keyOf(strokes);
    if (this.#last?.key === key) {
      const { handwriting } = this.#last;
      return handwriting?.unsure === true ? undefined : (handwriting?.text ?? null);
    }
    return couldBeWriting(strokes) ? undefined : null;
  }

  settle(strokes: readonly Stroke[]): Promise<string | null> {
    const key = this.#keyOf(strokes);
    if (this.#last?.key === key) {
      const { handwriting } = this.#last;
      this.forget();
      return this.#considered(strokes, handwriting);
    }
    if (!couldBeWriting(strokes)) {
      this.forget();
      return Promise.resolve(null);
    }
    const { reading, controller } = this.#attemptFor(strokes);
    this.#turnPage();
    return reading.then((handwriting) => this.#considered(strokes, handwriting, controller.signal));
  }

  forget(): void {
    this.#attempt?.controller.abort();
    this.#turnPage();
  }

  async #considered(
    strokes: readonly Stroke[],
    handwriting: Handwriting | null,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (handwriting?.unsure !== true) return handwriting?.text ?? null;
    const settled = await this.#reader
      .read(strokes, { settled: true, ...(signal === undefined ? {} : { signal }) })
      .catch(() => null);
    return settled?.text ?? null;
  }

  #attemptFor(strokes: readonly Stroke[]): Attempt {
    const key = this.#keyOf(strokes);
    return this.#attempt?.key === key ? this.#attempt : this.#begin(key, strokes);
  }

  #begin(key: string, strokes: readonly Stroke[]): Attempt {
    this.#attempt?.controller.abort();
    const controller = new AbortController();
    const reading = this.#reader.read(strokes, { signal: controller.signal }).catch(() => null);
    const attempt: Attempt = { key, controller, reading };
    this.#attempt = attempt;
    void reading.then((handwriting) => {
      if (this.#attempt !== attempt) return;
      this.#attempt = null;
      this.#last = { key, handwriting };
    });
    return attempt;
  }

  #turnPage(): void {
    this.#generation += 1;
    this.#attempt = null;
    this.#last = null;
  }

  /** Strokes only ever get appended within one page, so counts alone tell the prefixes apart. */
  #keyOf(strokes: readonly Stroke[]): string {
    const points = strokes.reduce((total, stroke) => total + stroke.length, 0);
    return `${this.#generation}:${strokes.length}:${points}:${Math.round(strokesLength(strokes))}`;
  }
}
