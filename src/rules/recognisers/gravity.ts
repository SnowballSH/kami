import { type Amount, readAmount } from "../amounts";
import { BODY_WORDS, type CelestialBody, readBody } from "../bodies";
import { DIRECTION_WORDS, type Direction, fieldAlong, readDirection } from "../directions";
import { gravityRule, shownNumber } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { SUBJECTS } from "../subjects";
import { mentions, UNIVERSAL, vocabulary } from "../vocabulary";

const STANDARD_GRAVITY_MPS2 = 9.81;
const WEAK_GRAVITY = 0.4;
const STRONG_GRAVITY = 2;
const PLACE_WORD = "on";

const POINTING = vocabulary(`
  points, point, pointing, pulls, pull, pulling, goes, go, going, toward, towards, direction,
  force, field, acceleration, strength, surface, planet, ${PLACE_WORD}
`);
const FLIPS = vocabulary(`
  flip, flips, flipped, reverse, reversed, invert, inverted, antigravity, anti, opposite,
  backwards
`);
const WEAK = vocabulary("low, lower, weak, weaker, light, lighter, less, reduced, little");
const STRONG = vocabulary("high, higher, strong, stronger, heavy, heavier, more, big, crushing");
const FLOATING = vocabulary("weightless, float, floats, floating");

const KNOWN = knownWords(
  SUBJECTS.gravity,
  BODY_WORDS,
  DIRECTION_WORDS,
  POINTING,
  FLIPS,
  WEAK,
  STRONG,
  FLOATING,
);

interface Size {
  readonly inG: number;
  readonly origin: string | null;
}

const isPhysical = ({ unit }: Amount): boolean => unit === "g" || unit === "mps2";

const amountInG = ({ value, unit }: Amount): number =>
  unit === "g" || unit === "multiple" ? value : value / STANDARD_GRAVITY_MPS2;

const sizeOnBody = (body: CelestialBody, amount: Amount | null): Size => {
  const multiple = amount?.value ?? 1;
  const origin = multiple === 1 ? body.label : `${shownNumber(multiple)}x ${body.label}`;
  return { inG: body.gravity * multiple, origin };
};

const readSize = (words: readonly string[]): Size | null => {
  const amount = readAmount(words);
  const body = readBody(words);
  if (body !== null && (amount === null || !isPhysical(amount))) return sizeOnBody(body, amount);
  if (amount !== null) return { inG: amountInG(amount), origin: null };
  if (mentions(words, WEAK)) return { inG: WEAK_GRAVITY, origin: null };
  if (mentions(words, STRONG)) return { inG: STRONG_GRAVITY, origin: null };
  return null;
};

const isAboutGravity = (words: readonly string[]): boolean =>
  mentions(words, SUBJECTS.gravity) ||
  (words.includes(PLACE_WORD) && readBody(words) !== null) ||
  (mentions(words, UNIVERSAL) && (mentions(words, FLOATING) || mentions(words, FLIPS)));

const readHeading = (words: readonly string[]): Direction | null =>
  readDirection(words) ?? (mentions(words, FLIPS) ? "up" : null);

export const recogniseGravity: Recogniser = ({ words }) => {
  if (!understands(words, KNOWN) || !isAboutGravity(words)) return null;
  const size = mentions(words, FLOATING) ? { inG: 0, origin: null } : readSize(words);
  const heading = readHeading(words);
  if (size === null && heading === null) return null;
  return gravityRule(fieldAlong(heading ?? "down", size?.inG ?? 1), size?.origin ?? null);
};
