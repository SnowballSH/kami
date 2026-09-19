import { readAmount } from "../amounts";
import { scalarRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { SUBJECTS } from "../subjects";
import { INTENSIFIERS, mentions, UNIVERSAL, vocabulary } from "../vocabulary";

const NO_FRICTION = 0;
const LOW_FRICTION = 0.3;
const HIGH_FRICTION = 2.5;
const STICKY_FRICTION = 3;

const SLIPPERY = vocabulary(`
  ice, icy, slippery, slippy, slick, frictionless, greasy, oily, soapy, buttery
`);
const GRIPPY = vocabulary("sticky, grippy, rough, tacky, gluey");
const LOW = vocabulary("low, lower, less, little, weak, reduced");
const HIGH = vocabulary("high, higher, more, lots, strong, much");

const KNOWN = knownWords(SUBJECTS.friction, SLIPPERY, GRIPPY, LOW, HIGH, INTENSIFIERS);

const readStatedFriction = (words: readonly string[]): number | null => {
  const amount = readAmount(words);
  if (amount !== null)
    return amount.unit === "plain" || amount.unit === "multiple" ? amount.value : null;
  if (mentions(words, LOW)) return LOW_FRICTION;
  return mentions(words, HIGH) ? HIGH_FRICTION : null;
};

const readWorldTexture = (words: readonly string[]): number | null => {
  if (!mentions(words, UNIVERSAL)) return null;
  if (mentions(words, SLIPPERY)) return NO_FRICTION;
  return mentions(words, GRIPPY) ? STICKY_FRICTION : null;
};

export const recogniseFriction: Recogniser = ({ words }) => {
  if (!understands(words, KNOWN)) return null;
  const friction = mentions(words, SUBJECTS.friction)
    ? readStatedFriction(words)
    : readWorldTexture(words);
  return friction === null ? null : scalarRule("friction", friction);
};
