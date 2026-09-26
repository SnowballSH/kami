import { alignWords } from "./align";
import type { Proofread, ProofreadWord } from "./corrector";
import { doubtfulWords } from "./doubt";
import type { Lexicon } from "./lexicon";
import { ocrDistance } from "./ocrDistance";

export interface FaithfulnessLimits {
  /** The most characters a repair may change: this share of the note, and never fewer than `minEdits`. */
  readonly editShare: number;
  readonly minEdits: number;
  /** How many more or fewer words a repair may have. */
  readonly wordCountSlack: number;
  /** What turning an English word into a word no reading saw may cost (`ocrDistance`). */
  readonly englishEdits: number;
}

export const DEFAULT_FAITHFULNESS: FaithfulnessLimits = {
  editShare: 0.35,
  minEdits: 2,
  wordCountSlack: 1,
  englishEdits: 1,
};

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

const wordsOf = (text: string): readonly string[] => text.split(/\s+/).filter(Boolean);
const bare = (word: string): string => word.replace(EDGE_PUNCTUATION, "").toLowerCase();

/**
 * Whether a model's reconstruction of a note stays faithful to what was read:
 * - every word the note was not in doubt about is still there as it was (numbers included);
 * - a word it did change becomes a game word, a number, or a word one of the readings saw: a
 *   model's guess at a name or an ordinary word is no better than the reader's; and an English
 *   word becomes another only by a misreading's worth of edits, unless a reading saw it;
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
  const readElsewhere = (replacement: string): boolean =>
    replacement.split(" ").every((part) => seen.has(bare(part)));
  const isEnglish = ({ kind }: ProofreadWord): boolean => kind === "common" || kind === "rare";
  const eachWordFaithful = proofread.words.every((word, index) => {
    const replacement = aligned[index];
    if (replacement !== undefined && bare(replacement) === bare(word.text)) return true;
    if (!doubtful.has(word)) return false;
    if (!isEnglish(word)) return replacement === undefined || isVouchedFor(replacement);
    return (
      replacement !== undefined &&
      isVouchedFor(replacement) &&
      (readElsewhere(replacement) ||
        ocrDistance(bare(word.text), bare(replacement)) <= limits.englishEdits)
    );
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
