import { alignWords } from "./align";
import type { Proofread } from "./corrector";
import { doubtfulWords } from "./doubt";
import type { Lexicon } from "./lexicon";
import { ocrDistance } from "./ocrDistance";

export interface FaithfulnessLimits {
  /** The most characters a repair may change: this share of the note, and never fewer than `minEdits`. */
  readonly editShare: number;
  readonly minEdits: number;
  /** How many more or fewer words a repair may have. */
  readonly wordCountSlack: number;
}

export const DEFAULT_FAITHFULNESS: FaithfulnessLimits = {
  editShare: 0.35,
  minEdits: 2,
  wordCountSlack: 1,
};

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const wordsOf = (text: string): readonly string[] => text.split(/\s+/).filter(Boolean);
const bare = (word: string): string => word.replace(EDGE_PUNCTUATION, "").toLowerCase();

/**
 * Whether a model's reconstruction of a note stays faithful to what was read:
 * - every word the note was not in doubt about is still there as it was (numbers included);
 * - a word it did change becomes a game word, a number, or a word one of the readings saw: a
 *   model's guess at a name or an ordinary word is no better than the reader's;
 * - about as many words, and only a few characters changed in all.
 */
export const isFaithful = (
  proofread: Proofread,
  repaired: string,
  lexicon: Lexicon,
  limits: FaithfulnessLimits = DEFAULT_FAITHFULNESS,
): boolean => {
  const answered = wordsOf(repaired);
  const aligned = alignWords(
    proofread.words.map(({ text }) => text),
    answered,
  );
  const doubtful = new Set(doubtfulWords(proofread));
  const seen = new Set(
    [proofread.read, ...proofread.alternatives].flatMap((reading) => wordsOf(reading).map(bare)),
  );
  const isVouchedFor = (replacement: string): boolean =>
    replacement.split(" ").every((part) => {
      const word = bare(part);
      return word === "" || /^\d/.test(word) || seen.has(word) || lexicon.kindOf(word) === "game";
    });
  const eachWordFaithful = proofread.words.every((word, index) => {
    const replacement = aligned[index];
    if (replacement !== undefined && bare(replacement) === bare(word.text)) return true;
    if (!doubtful.has(word)) return false;
    return replacement === undefined || isVouchedFor(replacement);
  });
  const newWordsVouchedFor = answered.every((word) => aligned.includes(word) || isVouchedFor(word));
  return (
    eachWordFaithful &&
    newWordsVouchedFor &&
    Math.abs(answered.length - proofread.words.length) <= limits.wordCountSlack &&
    ocrDistance(proofread.text, repaired) <=
      Math.max(limits.minEdits, limits.editShare * proofread.text.length)
  );
};
