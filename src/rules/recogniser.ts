import { AMOUNT_WORDS, isNumeral } from "./amounts";
import type { Sentence } from "./normalise";
import type { CompiledRule } from "./types";
import { SCOPE, union, type Vocabulary } from "./vocabulary";

/** Reads one kind of rule. Null unless it accounts for every word in the sentence. */
export type Recogniser = (sentence: Sentence) => CompiledRule | null;

export const knownWords = (...vocabularies: readonly Iterable<string>[]): Vocabulary =>
  union(AMOUNT_WORDS, SCOPE, ...vocabularies);

export const understands = (words: readonly string[], known: Vocabulary): boolean =>
  words.every((word) => known.has(word) || isNumeral(word));
