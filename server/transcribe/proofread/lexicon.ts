import american10 from "wordlist-english/american-words-10.json" with { type: "json" };
import american20 from "wordlist-english/american-words-20.json" with { type: "json" };
import american35 from "wordlist-english/american-words-35.json" with { type: "json" };
import american40 from "wordlist-english/american-words-40.json" with { type: "json" };
import english10 from "wordlist-english/english-words-10.json" with { type: "json" };
import english20 from "wordlist-english/english-words-20.json" with { type: "json" };
import english35 from "wordlist-english/english-words-35.json" with { type: "json" };
import english40 from "wordlist-english/english-words-40.json" with { type: "json" };
import * as namingWords from "../../../src/cat/lexicon";
import { RULE_WORDS } from "../../../src/rules";
import { SummoningLexicon, WISH_WORDS } from "../../../src/summoning";
import { type NatureTable, quickdrawNatureTable } from "../../natures/natureTable";

/** How a word is known: the game's own, everyday English, or rarer English. */
export type WordKind = "game" | "common" | "rare";

/** The cast of docs/spec.md, as players write their names. */
const CHARACTERS = ["alice", "kami", "sumikui", "bokushoku", "cheshire", "rabbit", "cat"];

const WORD = /^[a-z]+$/;
const KNOWN_BEST_FIRST: readonly WordKind[] = ["game", "common", "rare"];

const wordsIn = (phrases: Iterable<string>): readonly string[] =>
  [...phrases]
    .flatMap((phrase) => phrase.toLowerCase().split(/[\s-]+/))
    .filter((word) => WORD.test(word));

const withoutArticle = (name: string): string => name.replace(/^(?:an?|the|some)\s+/i, "");

/** SCOWL's sizes 10–20 (≈ 11 000 everyday words) and 35–40 (≈ 32 000 rarer ones), via wordlist-english. */
const COMMON_ENGLISH: readonly string[] = [
  ...english10,
  ...english20,
  ...american10,
  ...american20,
];
const RARE_ENGLISH: readonly string[] = [...english35, ...english40, ...american35, ...american40];

/**
 * The words a handwriting proofreader may trust or snap to. Game words come from the game's own
 * sources of truth: the rule grammar and its places, the wish grammar, the Cat's naming lexicon,
 * every name a Quick, Draw! category and its scenes answer to, the nature table's display names,
 * and the cast. Everyday
 * English keeps an ordinary word from being forced into a game word.
 */
export class Lexicon {
  readonly #kinds = new Map<string, WordKind>();

  constructor(game: Iterable<string>, common: Iterable<string>, rare: Iterable<string>) {
    for (const word of wordsIn(rare)) this.#kinds.set(word, "rare");
    for (const word of wordsIn(common)) this.#kinds.set(word, "common");
    for (const word of wordsIn(game)) this.#kinds.set(word, "game");
  }

  /**
   * How a word is known, reading "it's" as "its", "moon's" as "moon" and "ink-eater" by its
   * parts (the least known of them).
   */
  kindOf(word: string): WordKind | null {
    const lower = word.toLowerCase().replaceAll("’", "'");
    const known =
      this.#kinds.get(lower) ??
      this.#kinds.get(lower.replaceAll("'", "")) ??
      this.#kinds.get(lower.replace(/'s$/, ""));
    if (known !== undefined || !lower.includes("-")) return known ?? null;
    const kinds = lower.split("-").map((part) => this.#kinds.get(part) ?? null);
    if (kinds.includes(null)) return null;
    return KNOWN_BEST_FIRST.findLast((kind) => kinds.includes(kind)) ?? null;
  }

  /** The words a misread may be snapped to: the game's and everyday English. */
  *targets(): Iterable<readonly [string, WordKind]> {
    for (const entry of this.#kinds) if (entry[1] !== "rare") yield entry;
  }

  get gameWords(): readonly string[] {
    return [...this.#kinds].flatMap(([word, kind]) => (kind === "game" ? [word] : []));
  }
}

/** Every word the Cat's naming lexicon lists: what a drawing's name may say ("eat me", "bouncy"). */
const NAMING_WORDS: readonly string[] = Object.values(namingWords).flatMap(
  (entry: unknown): readonly string[] => {
    if (Array.isArray(entry)) return entry.filter((word) => typeof word === "string");
    if (typeof entry === "object" && entry !== null) {
      return Object.values(entry).flatMap((words: unknown) =>
        Array.isArray(words) ? words.filter((word) => typeof word === "string") : [],
      );
    }
    return [];
  },
);

export const gameWordsOf = (natures: NatureTable): readonly string[] => [
  ...RULE_WORDS,
  ...NAMING_WORDS,
  ...WISH_WORDS,
  ...CHARACTERS,
  ...new SummoningLexicon(natures.categories).names,
  ...natures.categories.map((category) => withoutArticle(natures.describe(category).name)),
];

export const createKamiLexicon = (natures: NatureTable = quickdrawNatureTable): Lexicon =>
  new Lexicon(gameWordsOf(natures), COMMON_ENGLISH, RARE_ENGLISH);
