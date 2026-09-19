import { METRES_PER_SECOND_SQUARED, PERCENT } from "./normalise";
import { union, type Vocabulary, vocabulary } from "./vocabulary";

export type AmountUnit = "plain" | "g" | "mps2" | "multiple";

export interface Amount {
  readonly value: number;
  readonly unit: AmountUnit;
}

const NUMERAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:\/\d+(?:\.\d+)?)?$/;
const PERCENT_SCALE = 100;

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
]);

const MULTIPLE_WORDS: ReadonlyMap<string, number> = new Map([
  ["half", 1 / 2],
  ["halved", 1 / 2],
  ["third", 1 / 3],
  ["quarter", 1 / 4],
  ["double", 2],
  ["doubled", 2],
  ["twice", 2],
  ["triple", 3],
  ["tripled", 3],
  ["thrice", 3],
  ["quadruple", 4],
]);

const NOTHING_WORDS = vocabulary(
  "no, none, off, without, nil, disable, disabled, remove, removed, kill",
);

const G_UNITS = vocabulary("g, gs, gee, gees");
const MULTIPLIER_WORDS = vocabulary("x, times");

export const AMOUNT_WORDS: Vocabulary = union(
  NUMBER_WORDS.keys(),
  MULTIPLE_WORDS.keys(),
  NOTHING_WORDS,
  G_UNITS,
  MULTIPLIER_WORDS,
  [METRES_PER_SECOND_SQUARED, PERCENT],
);

const numeralValue = (word: string): number | null => {
  if (!NUMERAL.test(word)) return null;
  const [numerator = "", denominator] = word.split("/");
  const value =
    denominator === undefined ? Number(numerator) : Number(numerator) / Number(denominator);
  return Number.isFinite(value) ? value : null;
};

const numberValue = (word: string): number | null => NUMBER_WORDS.get(word) ?? numeralValue(word);

export const isNumeral = (word: string): boolean => numeralValue(word) !== null;

const measured = (value: number, before: string | undefined, after: string | undefined): Amount => {
  if (after === PERCENT) return { value: value / PERCENT_SCALE, unit: "multiple" };
  if (after === METRES_PER_SECOND_SQUARED) return { value, unit: "mps2" };
  if (after !== undefined && G_UNITS.has(after)) return { value, unit: "g" };
  const multiplies = [before, after].some(
    (neighbour) => neighbour !== undefined && MULTIPLIER_WORDS.has(neighbour),
  );
  return { value, unit: multiplies ? "multiple" : "plain" };
};

const firstNumber = (words: readonly string[]): Amount | null => {
  const at = words.findIndex((word) => numberValue(word) !== null);
  const value = numberValue(words[at] ?? "");
  return value === null ? null : measured(value, words[at - 1], words[at + 1]);
};

const firstMultiple = (words: readonly string[]): Amount | null => {
  const value = words.map((word) => MULTIPLE_WORDS.get(word)).find((found) => found !== undefined);
  return value === undefined ? null : { value, unit: "multiple" };
};

const nothing = (words: readonly string[]): Amount | null =>
  words.some((word) => NOTHING_WORDS.has(word)) ? { value: 0, unit: "plain" } : null;

/** The one quantity a sentence states: a numeral with its unit, else "half"/"double", else "no". */
export const readAmount = (words: readonly string[]): Amount | null =>
  firstNumber(words) ?? firstMultiple(words) ?? nothing(words);

export const countNumbers = (words: readonly string[]): number =>
  words.filter((word) => numberValue(word) !== null).length;
