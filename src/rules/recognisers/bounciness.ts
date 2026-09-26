import { readAmount } from "../amounts";
import { scalarRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { SUBJECTS } from "../subjects";
import { INTENSIFIERS, mentions, UNIVERSAL, type Vocabulary, vocabulary } from "../vocabulary";

const BOUNCY = 0.8;
const VERY_BOUNCY = 1;

const BOUNCY_WORDS = vocabulary(`
  bouncy, bouncey, bouncier, springy, rubbery, elastic, rubber, bounce, bounces, bouncing
`);

export const BOUNCINESS_WORDS: Vocabulary = knownWords(
  SUBJECTS.bounciness,
  BOUNCY_WORDS,
  INTENSIFIERS,
);

export const recogniseBounciness: Recogniser = ({ words }) => {
  if (!understands(words, BOUNCINESS_WORDS)) return null;
  const described = mentions(words, BOUNCY_WORDS);
  if (!described && !mentions(words, SUBJECTS.bounciness)) return null;
  const amount = readAmount(words);
  if (amount !== null) {
    return amount.unit === "plain" || amount.unit === "multiple"
      ? scalarRule("bounciness", amount.value)
      : null;
  }
  if (!described || !mentions(words, UNIVERSAL)) return null;
  return scalarRule("bounciness", mentions(words, INTENSIFIERS) ? VERY_BOUNCY : BOUNCY);
};
