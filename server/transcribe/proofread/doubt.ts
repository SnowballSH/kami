import type { Proofread, ProofreadWord } from "./corrector";

export interface DoubtFloors {
  /** An English word the reader was less sure of than this is in doubt. */
  readonly english: number;
  /** A word nobody knows is in doubt unless the reader was at least this sure of it (a name). */
  readonly unknown: number;
}

export const DEFAULT_DOUBT: DoubtFloors = { english: 0.8, unknown: 0.9 };

const SHORTEST_UNKNOWN = 3;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\d/;
const QUANTITY = /^[-+]?\d+(?:\.\d+)?(?:x|%|°|g)?$/;
const NOT_A_LETTER = /[^\p{L}]/gu;

/**
 * Whether a word may well be misread: a number that is not a plain quantity ("05.9"), or a word
 * that is not the game's and that the reader was unsure of. Game words are never in doubt: the
 * game's vocabulary vouches for them, however unsure the reader was.
 */
export const isDoubtfulWord = (
  { text, sureness, kind }: ProofreadWord,
  floors: DoubtFloors = DEFAULT_DOUBT,
): boolean => {
  if (HAS_DIGIT.test(text)) return !QUANTITY.test(text);
  if (!HAS_LETTER.test(text) || kind === "game") return false;
  if (kind !== null) return sureness < floors.english;
  return text.replace(NOT_A_LETTER, "").length >= SHORTEST_UNKNOWN && sureness < floors.unknown;
};

export const doubtfulWords = (
  { words }: Proofread,
  floors: DoubtFloors = DEFAULT_DOUBT,
): readonly ProofreadWord[] => words.filter((word) => isDoubtfulWord(word, floors));
