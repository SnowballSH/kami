import type { MotionEdit } from "../rules/types";
import { FLEEING_WORDS, FLEERS, FOLLOWERS, FOLLOWING_WORDS } from "./lexicon";
import { isCreature } from "./natures";
import { indexOfSequence, type Phrase, stemsOf } from "./phrase";
import type { Nature, Temper } from "./types";

interface Leaning {
  readonly temper: Temper;
  readonly keyword: string;
}

const leanings = (words: readonly string[], temper: Temper): readonly Leaning[] =>
  words.map((keyword) => ({ temper, keyword }));

const TOLD: readonly Leaning[] = [
  ...leanings(FOLLOWING_WORDS, "follows"),
  ...leanings(FLEEING_WORDS, "flees"),
];

const BORN: readonly Leaning[] = [...leanings(FOLLOWERS, "follows"), ...leanings(FLEERS, "flees")];

const longestSaid = (phrase: Phrase, table: readonly Leaning[]): Temper | undefined =>
  table
    .filter(({ keyword }) => indexOfSequence(phrase.stems, stemsOf(keyword)) >= 0)
    .sort((a, b) => b.keyword.length - a.keyword.length)[0]?.temper;

/**
 * How a creature will take to Alice. What the player says of it wins ("a shy dog" flees); failing
 * that, some animals have a temper by name ("a dog" follows, "a mouse" flees). Only creatures
 * have one — a loyal rock is still a rock.
 */
export const temperOf = (phrase: Phrase, nature: Nature): Temper | undefined =>
  isCreature(nature) ? (longestSaid(phrase, TOLD) ?? longestSaid(phrase, BORN)) : undefined;

const HEED_OF: Readonly<Record<Temper, number>> = { follows: 1, flees: -1 };

/** A temper as the `heed` dial it sets on the drawing's own motion, so laws can later overrule it. */
export const heedOf = (temper: Temper | undefined): MotionEdit =>
  temper === undefined ? {} : { heed: HEED_OF[temper] };

export const temperOfHeed = (heed: number): Temper | null =>
  heed > 0 ? "follows" : heed < 0 ? "flees" : null;
