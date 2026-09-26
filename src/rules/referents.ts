import { ALICE } from "./subjects";
import { union, vocabulary } from "./vocabulary";

/** Words that stand for the thing a note is written beside: "it spins", "make them heavy". */
export const PRONOUNS = vocabulary(`
  it, its, itself, this, that, these, those, they, them, their, themselves
`);

const HER_OR_ME = union(ALICE, vocabulary("me, myself, us"));

/** Words after which a name goes on about something else: "a bag *of* cats" is a bag. */
const QUALIFIERS = vocabulary(`
  of, with, in, on, from, wearing, holding, who, that, which, named, called
`);

const LEADING = vocabulary("a, an, the, some, my, our, your, this, that, these, those");

/**
 * Whether the sentence's pronoun is the one doing the thing: "it follows me" is about the thing,
 * "Alice chases it" is about her, so a pronoun only refers once it comes before her.
 */
export const refersBack = (spoken: readonly string[]): boolean => {
  const pronoun = spoken.findIndex((word) => PRONOUNS.has(word));
  const her = spoken.findIndex((word) => HER_OR_ME.has(word));
  return pronoun >= 0 && (her < 0 || pronoun < her);
};

/** The last word before any qualifier: "rabbit hole" is a hole and "a king of the hill" a king. */
export const headOf = (words: readonly string[]): string | undefined => {
  const qualified = words.findIndex((word, at) => at > 0 && QUALIFIERS.has(word));
  return words.slice(0, qualified < 0 ? words.length : qualified).at(-1);
};

/**
 * The one noun a pronoun beside a drawing called `name` stands for: "boat" for "a little boat",
 * "cat" for "a cat that follows her". Null for a name with no words in it.
 */
export const referentOf = (name: string): string | null => {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
  const start = words.findIndex((word) => !LEADING.has(word));
  return start < 0 ? null : (headOf(words.slice(start)) ?? null);
};
