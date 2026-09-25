import type { Stroke } from "../../src/core/geometry";

export interface TranscribeOptions {
  /** The player drew on or left: the answer is no longer wanted. */
  readonly signal?: AbortSignal;
}

/** Reads handwriting from pen strokes. `null` means "a drawing, not writing" (or no answer). */
export interface HandwritingTranscriber {
  readonly ready: boolean;
  transcribe(strokes: readonly Stroke[], options?: TranscribeOptions): Promise<string | null>;
  warmUp(): Promise<boolean>;
}

const MAX_TEXT_LENGTH = 80;
const MIN_DISTINCT_LETTERS = 2;

/**
 * A fence reads as "IIIIII" and a box as "O" to a keen reader: words have at least two different
 * letters or digits in them, and a whiteboard note fits on a line.
 */
export const readsAsWriting = (text: string): boolean => {
  const letters = new Set(text.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []);
  return text.length > 0 && text.length <= MAX_TEXT_LENGTH && letters.size >= MIN_DISTINCT_LETTERS;
};

/** Whitespace collapsed, then held to `readsAsWriting`: the one shape every reader's answer takes. */
export const asWriting = (text: string | null): string | null => {
  if (text === null) return null;
  const tidy = text.replace(/\s+/g, " ").trim();
  return readsAsWriting(tidy) ? tidy : null;
};
