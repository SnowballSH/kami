import { type Stroke, strokesLength } from "../core/geometry";
import type { HandwritingReader } from "../persistence/types";
import { couldBeWriting } from "./gate";
import type { PenReader } from "./types";

interface Attempt {
  readonly key: string;
  readonly controller: AbortController;
  readonly text: Promise<string | null>;
}

interface Reading {
  readonly key: string;
  readonly text: string | null;
}

/**
 * Every pen-lift starts a read of everything drawn so far and cancels the one before it (only the
 * newest strokes can be the final ones), so when the ink settles ~a second after the last lift
 * the answer for exactly those strokes is usually already in, or about to be.
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
    if (this.#last?.key === key) return this.#last.text;
    return couldBeWriting(strokes) ? undefined : null;
  }

  settle(strokes: readonly Stroke[]): Promise<string | null> {
    const known = this.recall(strokes);
    if (known !== undefined) {
      this.forget();
      return Promise.resolve(known);
    }
    const { text } = this.#attemptFor(strokes);
    this.#turnPage();
    return text;
  }

  forget(): void {
    this.#attempt?.controller.abort();
    this.#turnPage();
  }

  #attemptFor(strokes: readonly Stroke[]): Attempt {
    const key = this.#keyOf(strokes);
    return this.#attempt?.key === key ? this.#attempt : this.#begin(key, strokes);
  }

  #begin(key: string, strokes: readonly Stroke[]): Attempt {
    this.#attempt?.controller.abort();
    const controller = new AbortController();
    const text = this.#reader.read(strokes, { signal: controller.signal }).catch(() => null);
    const attempt: Attempt = { key, controller, text };
    this.#attempt = attempt;
    void text.then((read) => {
      if (this.#attempt !== attempt) return;
      this.#attempt = null;
      this.#last = { key, text: read };
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
