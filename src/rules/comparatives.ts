import { mentions, type Vocabulary, vocabulary } from "./vocabulary";

/**
 * How "less X" reads on a dial: as its contrary ("less heavy" is light), or as X softened back
 * toward the dial's plain value ("less cold" is mild), for a dial whose contrary is another regime
 * altogether: heat that melts the ice, a slick ramp turned sticky.
 */
export type Lessening = "contrary" | "softened";

/** What a dial reads for "more" and "less" said of it alone: "the rock weighs less". */
export interface Comparatives {
  readonly more: number;
  readonly less: number;
  readonly lessening: Lessening;
}

/** Halfway from the plain value to the one a quality asks for: "slightly heavier" is 1.5x. */
export const weakened = (value: number, plain: number): number => plain + (value - plain) / 2;

/**
 * "less heavy" is lighter than plain, not heavier: the dial's own "less" (its "more", for "less
 * light"); failing that the reciprocal about its plain value ("spins less fast" is 0.5 turns/s);
 * and for a dial whose plain value is none at all, half the quality ("bounces less"). A dial that
 * softens never crosses its plain value: "less cold" is halfway from cold back to mild.
 */
export const lessened = (value: number, plain: number, compared: Comparatives | null): number => {
  if (compared?.lessening === "softened") return weakened(value, plain);
  const opposite = value > plain ? compared?.less : value < plain ? compared?.more : undefined;
  if (opposite !== undefined) return opposite;
  return plain !== 0 && value !== 0 ? (plain * plain) / value : weakened(value, plain);
};

/** Words that compare a quality to its plain self, so they turn a reading around: "less heavy". */
export const FEWER = vocabulary(`
  less, fewer, lesser, decrease, decreases, decreased, reduce, reduces, reduced, lessen, lessens,
  lessened, halve, halves, halved
`);

/**
 * Words that turn a dial one way or the other when no reading says how: "temperature down",
 * "the rock's weight is lower". Beside a reading they say where, not how much: "alice shrinks down".
 */
export interface Turning {
  readonly up: Vocabulary;
  readonly down: Vocabulary;
}

/** A reading said with a comparative: "less" turns it around, a turning word only sets an unread dial. */
export const compare = (
  value: number | null,
  plain: number,
  compared: Comparatives | null,
  words: readonly string[],
  turning: Turning,
): number | null => {
  if (mentions(words, FEWER))
    return value === null ? (compared?.less ?? null) : lessened(value, plain, compared);
  if (value !== null) return value;
  if (mentions(words, turning.down)) return compared?.less ?? null;
  if (mentions(words, turning.up)) return compared?.more ?? null;
  return null;
};
