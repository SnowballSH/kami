import { type SummoningLexicon, wordsOf } from "./lexicon";
import type { Summons } from "./types";

/** A wish is never for more than this many things at once. */
export const MOST_SUMMONED = 8;
const SEVERAL = 2;
const ADJECTIVES_ALLOWED = 2;

const list = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .split(/[,\n]/)
      .map((word) => word.trim())
      .filter((word) => word.length > 0),
  );

/** Asking outright for a picture: with one of these, an unknown thing is something Kami cannot draw. */
const ASKING = list("summon, draw, sketch, spawn, conjure, doodle, manifest");
const VERBS = new Set([
  ...ASKING,
  ...list(`
    make, create, add, bring, put, place, build, give, show, want, need, wish for, let there be,
    there is, there are, i want, i need, i wish for, give me, show me, make me, bring me,
    can i have, may i have, i would like, id like
  `),
]);
const FILLERS = list(`
  please, kami, now, here, there, me, us, up, forth, quickly, too, also, right here, over here,
  right there, for me, for us, for her, for him, for alice, next to alice, next to her, beside alice,
  beside her, by alice, by her, in front of alice, in front of her, hey, oh, dear, ok, okay,
  can you, could you, would you, will you
`);
const CHATTER = new Set([",", ...FILLERS]);
/** The Sumikui is summoned by law, never as a picture; the compiler hears those words first. */
const NEVER_A_PICTURE = /\b(?:ink\s*eater|sumikui|bokushoku)\b/;
/** Words about what is already there, never about a new thing: "make it rain" is not a wish. */
const PRONOUNS = list(
  "it, its, them, him, her, his, hers, their, alice, she, he, they, this, that, these, those, all, everything",
);
const SEPARATORS = new Set([
  ",",
  "&",
  ...list(`
    and, with, plus, on, over, under, beside, near, by, in, at, behind, above, below, next, next to,
    onto, into, around, beneath, among, then, after, before, atop, upon, beyond, inside, of
  `),
]);
const COUNTS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  the: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  couple: 2,
  pair: 2,
  few: 3,
  some: 3,
  several: 3,
  handful: 3,
  bunch: 4,
  many: 4,
  lots: 4,
  lot: 4,
  dozen: MOST_SUMMONED,
};
const LONGEST_PHRASE = 4;

export interface Wish {
  readonly summons: readonly Summons[];
  /** The player asked outright ("summon", "draw me") rather than only naming things. */
  readonly explicit: boolean;
  /** What was asked for, in the player's words: "a rabbit", "two clouds". */
  readonly asked: string;
}

class Cursor {
  at = 0;

  constructor(readonly words: readonly string[]) {}

  /** The words with any leading or trailing chatter ("kami,", ", please") cut away. */
  static trimmed(words: readonly string[], chatter: ReadonlySet<string>): Cursor {
    let end = words.length;
    for (let length = Math.min(LONGEST_PHRASE, end); length >= 1; length--) {
      if (chatter.has(words.slice(end - length, end).join(" "))) {
        end -= length;
        length = Math.min(LONGEST_PHRASE, end) + 1;
      }
    }
    const cursor = new Cursor(words.slice(0, end));
    cursor.skipAll(chatter);
    return cursor;
  }

  get done(): boolean {
    return this.at >= this.words.length;
  }

  peek(offset = 0): string | undefined {
    return this.words[this.at + offset];
  }

  /** Consumes the longest phrase from `phrases` that starts here. */
  take(phrases: ReadonlySet<string>): boolean {
    for (let length = LONGEST_PHRASE; length >= 1; length--) {
      if (phrases.has(this.words.slice(this.at, this.at + length).join(" "))) {
        this.at += length;
        return true;
      }
    }
    return false;
  }

  skipAll(phrases: ReadonlySet<string>): number {
    let skipped = 0;
    while (this.take(phrases)) skipped++;
    return skipped;
  }
}

const numeral = (word: string | undefined): number | null => {
  if (word === undefined) return null;
  const named = COUNTS[word];
  if (named !== undefined) return named;
  return /^[1-9]$/.test(word) ? Number(word) : null;
};

/** "a rabbit", "three rabbits", "a few trees", "a couple of houses", "lots of stars". */
const takeCount = (cursor: Cursor): number | null => {
  const first = numeral(cursor.peek());
  if (first === null) return null;
  cursor.at++;
  const second = cursor.peek() === "of" ? null : numeral(cursor.peek());
  if (second !== null && first === 1) {
    cursor.at++;
    if (cursor.peek() === "of") cursor.at++;
    return second;
  }
  if (cursor.peek() === "of") cursor.at++;
  return first;
};

const takeThing = (cursor: Cursor, lexicon: SummoningLexicon): readonly Summons[] | null => {
  const count = takeCount(cursor);
  for (let adjectives = 0; adjectives <= ADJECTIVES_ALLOWED; adjectives++) {
    const word = cursor.peek(adjectives);
    if (word === undefined || SEPARATORS.has(word) || PRONOUNS.has(word)) return null;
    const found = lexicon.lookUp(cursor.words, cursor.at + adjectives);
    if (found === null) continue;
    cursor.at += adjectives + found.length;
    const times = count ?? (found.several && found.summons.length === 1 ? SEVERAL : 1);
    return found.summons.map((each) => ({ ...each, count: each.count * times }));
  }
  return null;
};

const merged = (summons: readonly Summons[]): readonly Summons[] => {
  const byCategory = new Map<string, number>();
  for (const { category, count } of summons)
    byCategory.set(category, (byCategory.get(category) ?? 0) + count);
  return [...byCategory].map(([category, count]) => ({ category, count }));
};

const capped = (summons: readonly Summons[]): readonly Summons[] => {
  let left = MOST_SUMMONED;
  const kept: Summons[] = [];
  for (const each of summons) {
    if (left === 0) break;
    const count = Math.min(each.count, left);
    left -= count;
    kept.push({ ...each, count });
  }
  return kept;
};

/**
 * Reads a wish for things: an optional asking ("summon", "draw me", "i want"), then things the
 * lexicon knows, each with an optional count and a couple of adjectives, joined by "and", commas
 * or a preposition. Anything the lexicon does not know makes it not a wish at all — a law, a name
 * for a drawing, or a remark, which the rest of the funnel handles.
 */
export const parseWish = (text: string, lexicon: SummoningLexicon): Wish | null => {
  const cursor = Cursor.trimmed(wordsOf(text), CHATTER);
  const asking = cursor.take(ASKING);
  const explicit = asking || cursor.take(VERBS);
  cursor.skipAll(CHATTER);
  const asked = cursor.words
    .slice(cursor.at)
    .filter((word) => word !== ",")
    .join(" ");
  if (asked.length === 0 || NEVER_A_PICTURE.test(asked)) return null;
  const nothingDrawable = asking ? { summons: [], explicit, asked } : null;
  if (lexicon.isEmpty) return nothingDrawable;

  const summons: Summons[] = [];
  for (;;) {
    const thing = takeThing(cursor, lexicon);
    if (thing === null) return nothingDrawable;
    summons.push(...thing);
    cursor.skipAll(FILLERS);
    if (cursor.done) return { summons: capped(merged(summons)), explicit, asked };
    if (cursor.skipAll(SEPARATORS) === 0) return nothingDrawable;
    cursor.skipAll(FILLERS);
  }
};
