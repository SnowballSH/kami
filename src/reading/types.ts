import type { Stroke } from "../core/geometry";

/**
 * Reads the player's pen strokes as words while they are still writing. A reading is only ever
 * trusted for exactly the strokes it was asked about: a prefix of a word is a different word.
 */
export interface PenReader {
  /** The pen lifted with these strokes on the board so far. */
  glimpse(strokes: readonly Stroke[]): void;
  /** What these strokes were read as, if the reading is already in; undefined while it is not. */
  recall(strokes: readonly Stroke[]): string | null | undefined;
  /** The strokes are final: the reading for exactly these, waiting for it if it is still out. */
  settle(strokes: readonly Stroke[]): Promise<string | null>;
  /** The strokes were dropped: nothing about them is wanted any more. */
  forget(): void;
}
