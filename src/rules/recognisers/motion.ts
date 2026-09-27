import { readAmount } from "../amounts";
import { compare, weakened } from "../comparatives";
import { type Direction, fieldAlong, readDirection } from "../directions";
import { type BodyScalarGoverns, bodyRule, thrustRule } from "../effects";
import { type Recogniser, understands } from "../recogniser";
import { ALICE } from "../subjects";
import { besides, targetOf } from "../targets";
import { type BodyGoverns, type CompiledRule, STILL, type Target } from "../types";
import {
  affirmed,
  mentions,
  NEGATION,
  NORMAL,
  SLIGHTLY,
  union,
  type Vocabulary,
} from "../vocabulary";
import { BACKWARDS, BODY_DIALS, type BodyDial, HEADINGS, TURNING } from "./bodyDials";

const headingOf = (words: readonly string[]): Direction | null =>
  readDirection(words) ??
  words.map((word) => HEADINGS.get(word)).find((heading) => heading !== undefined) ??
  null;

const isAbout = (dial: BodyDial, words: readonly string[]): boolean =>
  mentions(words, dial.about) ||
  (dial.steered !== undefined && mentions(words, dial.steered) && headingOf(words) !== null);

const ordinary = (governs: BodyGoverns): number => (governs === "thrust" ? 0 : STILL[governs]);

/** "a bit faster" is halfway from what the dial plainly does to what "faster" asks. */
const graded = (
  dial: BodyDial,
  value: number | null,
  plain: number,
  words: readonly string[],
): number | null => {
  if (!dial.graded) return value;
  const compared = compare(value, plain, dial.compared, words, TURNING);
  return compared !== null && mentions(words, SLIGHTLY) ? weakened(compared, plain) : compared;
};

/**
 * "not" turns a dial back to ordinary, and so does "normal" for a dial with degrees ("the dog is
 * normal size"). A power a body has or lacks has no ordinary degree: "the lamp glows normally"
 * says how it glows, not that it stops.
 */
const unsays = (dial: BodyDial, words: readonly string[]): boolean =>
  mentions(words, NEGATION) || (dial.graded && mentions(words, NORMAL));

const readDial = (dial: BodyDial, words: readonly string[]): number | null => {
  const affirmative = affirmed(words);
  if (affirmative !== null) return isAbout(dial, affirmative) ? readDial(dial, affirmative) : null;
  if (unsays(dial, words)) return ordinary(dial.governs);
  const amount = readAmount(words);
  if (amount !== null) return dial.fromAmount(amount);
  const reading = dial.readings.find(({ words: said }) => mentions(words, said));
  if (reading === undefined) return graded(dial, dial.implied, ordinary(dial.governs), words);
  return graded(dial, reading.value, dial.implied ?? ordinary(dial.governs), words);
};

const ruleFor = (
  dial: BodyDial,
  of: Target,
  value: number,
  words: readonly string[],
): CompiledRule => {
  if (dial.governs === "thrust") {
    return thrustRule(of, fieldAlong(headingOf(words) ?? "right", value));
  }
  const governs: BodyScalarGoverns = dial.governs;
  const sign = governs === "spin" && mentions(words, BACKWARDS) ? -1 : 1;
  return bodyRule(governs, of, sign * value);
};

export const MOTION_WORDS: Vocabulary = union(...BODY_DIALS.map(({ known }) => known));

/**
 * Laws about the bodies on the board rather than the world: "the wheel spins", "every rock is
 * twice as heavy", "the cart accelerates to the left", and the powers a named creature can gain —
 * "the dog can fly", "the cat is twice as fast", "the rabbit is huge", "the firefly glows". Runs after the world's own
 * recognisers, so "everything is bouncy" stays a world law; here a sentence must point at something.
 */
export const recogniseMotion: Recogniser = (sentence) => {
  const { words } = sentence;
  if (mentions(words, ALICE)) return null;
  for (const dial of BODY_DIALS) {
    if (!isAbout(dial, words)) continue;
    const of = targetOf(sentence, dial.known);
    if (of === null) return null;
    const rest = besides(words, of);
    if (!understands(rest, dial.known)) continue;
    const value = readDial(dial, rest);
    if (value !== null) return ruleFor(dial, of, value, rest);
  }
  return null;
};
