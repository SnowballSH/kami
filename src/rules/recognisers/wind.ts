import { type Amount, readAmount } from "../amounts";
import {
  DIRECTION_WORDS,
  type Direction,
  fieldAlong,
  opposite,
  readDirection,
} from "../directions";
import { windRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { SUBJECTS } from "../subjects";
import { INTENSIFIERS, mentions, vocabulary } from "../vocabulary";

const STANDARD_GRAVITY_MPS2 = 9.81;
const STEADY_WIND = 0.3;
const STRONG_WIND = 0.8;
const GENTLE_WIND = 0.1;
const DEFAULT_HEADING: Direction = "right";
const SOURCE_WORD = "from";

const NAMED_WINDS: ReadonlyMap<string, number> = new Map([
  ["breeze", 0.15],
  ["gale", 1],
  ["storm", 1],
  ["hurricane", 1.5],
]);
const WEATHER = vocabulary("windy, breezy, gusty, blustery, stormy");
const UPDRAFTS = vocabulary("updraft, updraught");
const BLOWING = vocabulary(`
  blows, blow, blowing, blown, toward, towards, goes, going, pushes, push, pushing, comes, coming,
  ${SOURCE_WORD}
`);
const STRONG = vocabulary("strong, stronger, heavy, hard, big, fierce, powerful, high, lots, more");
const GENTLE = vocabulary("gentle, light, soft, weak, slight, little, mild, low, less");

const KNOWN = knownWords(
  SUBJECTS.wind,
  DIRECTION_WORDS,
  WEATHER,
  UPDRAFTS,
  BLOWING,
  STRONG,
  GENTLE,
  INTENSIFIERS,
);

const amountInG = ({ value, unit }: Amount): number => {
  if (unit === "mps2") return value / STANDARD_GRAVITY_MPS2;
  return unit === "multiple" ? value * STEADY_WIND : value;
};

const readHeading = (words: readonly string[]): Direction | null => {
  const stated = readDirection(words) ?? (mentions(words, UPDRAFTS) ? "up" : null);
  return stated !== null && words.includes(SOURCE_WORD) ? opposite(stated) : stated;
};

const readStrength = (words: readonly string[]): number | null => {
  const amount = readAmount(words);
  if (amount !== null) return amountInG(amount);
  if (mentions(words, STRONG)) return STRONG_WIND;
  return mentions(words, GENTLE) ? GENTLE_WIND : null;
};

const namedStrength = (words: readonly string[]): number =>
  words.map((word) => NAMED_WINDS.get(word)).find((strength) => strength !== undefined) ??
  STEADY_WIND;

export const recogniseWind: Recogniser = ({ words }) => {
  if (!understands(words, KNOWN)) return null;
  const isWeather = mentions(words, WEATHER) || mentions(words, UPDRAFTS);
  if (!isWeather && !mentions(words, SUBJECTS.wind)) return null;
  const heading = readHeading(words);
  const strength = readStrength(words);
  const saysMoreThanANoun =
    isWeather || heading !== null || strength !== null || mentions(words, BLOWING);
  if (!saysMoreThanANoun) return null;
  return windRule(fieldAlong(heading ?? DEFAULT_HEADING, strength ?? namedStrength(words)));
};
