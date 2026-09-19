import { clamp } from "../core/geometry";
import { BOOSTERS, DAMPERS } from "./lexicon";
import { countMentions, type Phrase, vocabulary } from "./phrase";
import { STRENGTH_RANGE } from "./types";

const PLAIN_STRENGTH = 1;
const BOOST_STEP = 0.5;
const DAMP_STEP = 0.25;

const BOOSTER_VOCAB = vocabulary(BOOSTERS);
const DAMPER_VOCAB = vocabulary(DAMPERS);

export const strengthOf = (phrase: Phrase): number =>
  clamp(
    PLAIN_STRENGTH +
      BOOST_STEP * countMentions(phrase, BOOSTER_VOCAB) -
      DAMP_STEP * countMentions(phrase, DAMPER_VOCAB),
    STRENGTH_RANGE.min,
    STRENGTH_RANGE.max,
  );
