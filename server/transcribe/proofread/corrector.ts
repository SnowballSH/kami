import { FILLER } from "../../../src/rules/normalise";
import type { Transcript } from "../types";
import { alignWords, differenceShare } from "./align";
import type { Lexicon, WordKind } from "./lexicon";
import { MisreadWord } from "./ocrDistance";

/** One word of a proofread note: what the reader read, what it became, and how sure it was. */
export interface ProofreadWord {
  readonly read: string;
  readonly text: string;
  /** The reader's least sure character in the word; 1 when it gave none. */
  readonly sureness: number;
  /** How the final word is known, or null when neither the game nor English knows it. */
  readonly kind: WordKind | null;
  /** The closest game words to what was read, best first: hints for a second opinion. */
  readonly nearby: readonly string[];
}

export interface Proofread {
  readonly read: string;
  readonly text: string;
  readonly words: readonly ProofreadWord[];
  readonly alternatives: readonly string[];
}

export interface CorrectorTuning {
  /** Words shorter than this are never snapped to the vocabulary: "is", "to", "g". */
  readonly shortestWord: number;
  /** The most a snap may cost per letter of the word, and in all. */
  readonly costPerLetter: number;
  readonly maxCost: number;
  /** How much more likely a player writes a game word, or an everyday one, than an unknown one. */
  readonly prior: Readonly<Record<WordKind, number>>;
  /** How much better than keeping the word, and than the runner-up, a snap must be. */
  readonly margin: number;
  readonly lead: number;
  /** An English word only ever snaps to a game word, and only by an edit this cheap. */
  readonly englishCeiling: number;
  /** What taking another reading's game word may cost, per letter. */
  readonly otherReadingPerLetter: number;
  /** ...and may be at most this many letters longer or shorter. */
  readonly otherReadingLengthDifference: number;
  /** An English word gives way to another reading's game word only where the reader was less sure than this. */
  readonly englishSureness: number;
  /** The most another reading's number may differ from this one's, as a share of its characters. */
  readonly quantityDifference: number;
  /** The shortest unknown word worth splitting in two ("clonealice"). */
  readonly shortestSplit: number;
  readonly nearbyCount: number;
}

export const DEFAULT_TUNING: CorrectorTuning = {
  shortestWord: 3,
  costPerLetter: 0.3,
  maxCost: 1.5,
  prior: { game: 0.6, common: 0.3, rare: 0.15 },
  margin: 0.1,
  lead: 0.15,
  englishCeiling: 0.2,
  otherReadingPerLetter: 0.5,
  otherReadingLengthDifference: 2,
  englishSureness: 0.8,
  quantityDifference: 0.5,
  shortestSplit: 5,
  nearbyCount: 3,
};

const WORD_CORE = /^([^\p{L}\p{N}]*)(\p{L}+(?:['’-]\p{L}+)*)([^\p{L}\p{N}]*)$/u;
const JOINED = /['’-]/u;
const NUMERAL_LOOKALIKE = /^[0-9oOlI.,]*[0-9][0-9oOlI.,]*[x%°g]?$/;
const NUMERAL = /^-?\d*\.?\d+[x%°g]?$/;
const QUANTITY = /^-?\d+(?:\.\d+)?(?:x|%|°|g)?$/;
const LETTERS = /^\p{L}+$/u;
const NOT_A_LETTER = /[^\p{L}]/gu;
const DIGIT_OF: Readonly<Record<string, string>> = { o: "0", O: "0", l: "1", I: "1", ",": "." };
const EQUALS_LOOKALIKES = new Set(["-", "--", ":", "=="]);
const CAPITALISED = /^\p{Lu}/u;

interface Token {
  readonly text: string;
  readonly sureness: readonly number[];
}

const tokensOf = (text: string, sureness: readonly number[]): readonly Token[] => {
  const characters = Array.from(text);
  const aligned = sureness.length === characters.length;
  const tokens: Token[] = [];
  let current: string[] = [];
  let currentSureness: number[] = [];
  characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (current.length > 0) tokens.push({ text: current.join(""), sureness: currentSureness });
      current = [];
      currentSureness = [];
      return;
    }
    current.push(character);
    currentSureness.push(aligned ? (sureness[index] ?? 1) : 1);
  });
  if (current.length > 0) tokens.push({ text: current.join(""), sureness: currentSureness });
  return tokens;
};

const inCaseOf = (model: string, word: string): string => {
  if (model === model.toUpperCase() && model.length > 1) return word.toUpperCase();
  if (model[0] === model[0]?.toUpperCase())
    return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
  return word;
};

const leastOf = (values: readonly number[]): number =>
  values.length === 0 ? 1 : Math.min(...values);

interface Scored {
  readonly word: string;
  readonly kind: WordKind;
  readonly cost: number;
  readonly score: number;
}

/**
 * Snaps what a handwriting reader read toward the words Kami understands — deterministically, in
 * a few milliseconds a note. A word changes only when there is clear evidence: another reading
 * of the note saw a game word there, it is two known words run together, or a known word is
 * clearly the likelier thing to have been written. See `server/transcribe/PROOFREADING.md`.
 */
export class VocabularyCorrector {
  readonly #lexicon: Lexicon;
  readonly #tuning: CorrectorTuning;
  readonly #targets: readonly (readonly [string, WordKind])[];

  constructor(lexicon: Lexicon, tuning: CorrectorTuning = DEFAULT_TUNING) {
    this.#lexicon = lexicon;
    this.#tuning = tuning;
    this.#targets = [...lexicon.targets()];
  }

  correct({ text, sureness = [], alternatives = [] }: Transcript): Proofread {
    const tokens = tokensOf(text, sureness);
    const readings = alternatives.map((alternative) =>
      alignWords(
        tokens.map(({ text: word }) => word),
        tokensOf(alternative, []).map(({ text: word }) => word),
      ),
    );
    const words = tokens.flatMap((token, index) =>
      this.#correctToken(
        token,
        readings.flatMap((reading) => reading[index] ?? []),
        index === 0,
      ),
    );
    const fixed = withEqualsSigns(words.map(({ text: word }) => word));
    return {
      read: text,
      text: fixed.join(" "),
      words: words.map((word, index) => ({ ...word, text: fixed[index] ?? word.text })),
      alternatives,
    };
  }

  #correctToken(token: Token, seen: readonly string[], first: boolean): readonly ProofreadWord[] {
    const sureness = leastOf(token.sureness);
    const as = (
      text: string,
      kind: WordKind | null,
      nearby: readonly string[] = [],
    ): ProofreadWord => ({ read: token.text, text, sureness, kind, nearby });
    const quantity = seen.find(
      (other) =>
        QUANTITY.test(other) &&
        !QUANTITY.test(token.text) &&
        differenceShare(token.text, other) <= this.#tuning.quantityDifference,
    );
    if (NUMERAL_LOOKALIKE.test(token.text)) {
      const numeral = Array.from(token.text, (character) => DIGIT_OF[character] ?? character).join(
        "",
      );
      return [as(NUMERAL.test(numeral) ? numeral : (quantity ?? token.text), null)];
    }
    if (EQUALS_LOOKALIKES.has(token.text) && seen.includes("=")) return [as("=", null)];
    const parts = WORD_CORE.exec(token.text);
    if (parts === null) return [as(quantity ?? token.text, null)];
    const [, before = "", core = "", after = ""] = parts;
    const kind = this.#lexicon.kindOf(core);
    if (kind === "game" || JOINED.test(core)) return [as(token.text, kind)];
    const coreSureness = token.sureness.slice(before.length, before.length + core.length);
    const writtenAs = (replacement: readonly string[], nearby: readonly string[] = []) =>
      replacement.map((word, index) =>
        as(
          `${index === 0 ? before : ""}${index === 0 ? inCaseOf(core, word) : word}${index === replacement.length - 1 ? after : ""}`,
          this.#lexicon.kindOf(word),
          nearby,
        ),
      );
    const aName = CAPITALISED.test(core) && !first;
    const split = kind === null && !aName ? this.#split(core) : null;
    if (split !== null) return writtenAs(split);
    const elsewhere = this.#seenElsewhere(core, coreSureness, kind, seen);
    if (elsewhere !== null) return writtenAs(elsewhere);
    if (core.length < this.#tuning.shortestWord || aName) return [as(token.text, kind)];
    const ranked = this.#rank(core, coreSureness, kind);
    const nearby = ranked
      .filter(({ kind: found }) => found === "game")
      .slice(0, this.#tuning.nearbyCount)
      .map(({ word }) => word);
    const best = this.#clearBest(ranked, kind);
    return best === null ? [as(token.text, kind, nearby)] : writtenAs([best.word], nearby);
  }

  /**
   * What another reading saw where this one read `core`, when that is a game word (or known words,
   * one of them the game's) close enough to be a reading of the same ink. An English word gives
   * way only where the reader was unsure of it.
   */
  #seenElsewhere(
    core: string,
    sureness: readonly number[],
    kind: WordKind | null,
    seen: readonly string[],
  ): readonly string[] | null {
    if (kind !== null && leastOf(sureness) >= this.#tuning.englishSureness) return null;
    const misread = new MisreadWord(core, sureness);
    for (const other of seen) {
      const words = other
        .toLowerCase()
        .split(" ")
        .map((word) => word.replace(NOT_A_LETTER, ""));
      const kinds = words.map((word) => (word === "" ? null : this.#lexicon.kindOf(word)));
      if (kinds.includes(null) || !kinds.includes("game")) continue;
      const joined = words.join("");
      if (joined === core.toLowerCase() && words.length === 1) continue;
      if (Math.abs(joined.length - core.length) > this.#tuning.otherReadingLengthDifference)
        continue;
      const ceiling = this.#tuning.otherReadingPerLetter * Math.max(joined.length, core.length);
      if (misread.distanceTo(joined, ceiling) <= ceiling) return words;
    }
    return null;
  }

  /** Two known words run together, one of them the game's: "clonealice", "atiny". */
  #split(core: string): readonly [string, string] | null {
    if (core.length < this.#tuning.shortestSplit) return null;
    const lower = core.toLowerCase();
    for (let at = 1; at < lower.length; at++) {
      const first = lower.slice(0, at);
      const second = lower.slice(at);
      const kinds = [this.#lexicon.kindOf(first), this.#lexicon.kindOf(second)];
      if (kinds.includes(null) || !kinds.includes("game") || kinds.includes("rare")) continue;
      if (Math.min(first.length, second.length) < 2 && first !== "a") continue;
      return [first, second];
    }
    return null;
  }

  #clearBest(ranked: readonly Scored[], kind: WordKind | null): Scored | null {
    const [best, runnerUp] = ranked;
    if (best === undefined) return null;
    const keeping = -(kind === null ? 0 : this.#tuning.prior[kind]);
    const clearlyBetter =
      best.score < keeping - this.#tuning.margin &&
      (runnerUp === undefined || runnerUp.score - best.score >= this.#tuning.lead) &&
      (kind === null || (best.kind === "game" && best.cost <= this.#tuning.englishCeiling));
    return clearlyBetter ? best : null;
  }

  #rank(core: string, sureness: readonly number[], kind: WordKind | null): readonly Scored[] {
    const lower = core.toLowerCase();
    const ceiling = Math.min(this.#tuning.maxCost, this.#tuning.costPerLetter * core.length);
    const misread = new MisreadWord(lower, sureness);
    const scored: Scored[] = [];
    for (const [word, found] of this.#targets) {
      if (word === lower || Math.abs(word.length - lower.length) > 2) continue;
      if (kind !== null && found !== "game") continue;
      const cost = misread.distanceTo(word, ceiling);
      if (cost > ceiling) continue;
      scored.push({ word, kind: found, cost, score: cost - this.#tuning.prior[found] });
    }
    return scored.sort((a, b) => a.score - b.score);
  }
}

const DIGIT_AFTER_EQUALS: Readonly<Record<string, string>> = { I: "1", l: "1", O: "0", o: "0" };

const isEqualsSign = (
  word: string,
  before: string | undefined,
  after: string | undefined,
): boolean =>
  word === "-" &&
  before !== undefined &&
  LETTERS.test(before) &&
  !FILLER.has(before.toLowerCase()) &&
  after !== undefined &&
  NUMERAL.test(DIGIT_AFTER_EQUALS[after] ?? after);

/**
 * "daylight - 0.1": a dash standing alone between a word and a number is an equals sign, unless
 * the word is filler ("pulls at - 1 g" is a minus); and "g = I" is "g = 1".
 */
const withEqualsSigns = (words: readonly string[]): readonly string[] => {
  const signed = words.map((word, index) =>
    isEqualsSign(word, words[index - 1], words[index + 1]) ? "=" : word,
  );
  return signed.map((word, index) =>
    signed[index - 1] === "=" ? (DIGIT_AFTER_EQUALS[word] ?? word) : word,
  );
};
