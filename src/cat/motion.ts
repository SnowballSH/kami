import type { MotionEdit } from "../rules/types";
import {
  GLOWING_CREATURES,
  NATURE_DESCRIPTIONS,
  NATURE_THINGS,
  PROPELLED_WORDS,
  SPINNING_WORDS,
  WIDDERSHINS_WORDS,
} from "./lexicon";
import { isCreature } from "./natures";
import { indexOfSequence, mentions, type Phrase, stemsOf, vocabulary } from "./phrase";
import type { Nature } from "./types";

const SPINNING = vocabulary(SPINNING_WORDS);
const WIDDERSHINS = vocabulary(WIDDERSHINS_WORDS);
const PROPELLED = vocabulary(PROPELLED_WORDS);
const UPWARD = vocabulary(["up", "upward", "upwards", "rising", "lifting", "skyward"]);
const LEFTWARD = vocabulary(["left", "leftward", "leftwards", "west"]);

const GLOWING = [
  ...NATURE_DESCRIPTIONS.lantern,
  ...NATURE_THINGS.lantern,
  ...GLOWING_CREATURES,
].map(stemsOf);

const TURNS_PER_SECOND = 1;
const GLOWS = 1;
const THRUST_G = 0.5;

const spinOf = (phrase: Phrase, strength: number): MotionEdit =>
  mentions(phrase, SPINNING)
    ? { spin: (mentions(phrase, WIDDERSHINS) ? -1 : 1) * TURNS_PER_SECOND * strength }
    : {};

const thrustOf = (phrase: Phrase, strength: number): MotionEdit => {
  if (!mentions(phrase, PROPELLED)) return {};
  const size = THRUST_G * strength;
  if (mentions(phrase, UPWARD)) return { thrust: { x: 0, y: -size } };
  return { thrust: { x: mentions(phrase, LEFTWARD) ? -size : size, y: 0 } };
};

/** Only a creature carries light as a power; anything else that glows by name is a lantern. */
const glowOf = (phrase: Phrase, nature: Nature): MotionEdit =>
  isCreature(nature) && GLOWING.some((stems) => indexOfSequence(phrase.stems, stems) >= 0)
    ? { glow: GLOWS }
    : {};

/** The physics a name asks for on top of its nature; undefined when it asks for none. */
export const motionOf = (
  phrase: Phrase,
  strength: number,
  nature: Nature,
): MotionEdit | undefined => {
  const motion = {
    ...spinOf(phrase, strength),
    ...thrustOf(phrase, strength),
    ...glowOf(phrase, nature),
  };
  return Object.keys(motion).length === 0 ? undefined : motion;
};
