import { DETERMINERS, FILLER } from "./normalise";
import { AIR_WORDS } from "./recognisers/air";
import { BOUNCINESS_WORDS } from "./recognisers/bounciness";
import { DIAL_WORDS } from "./recognisers/dials";
import { FRICTION_WORDS } from "./recognisers/friction";
import { GRAVITY_WORDS } from "./recognisers/gravity";
import { HEED_WORDS } from "./recognisers/heed";
import { MOTION_WORDS } from "./recognisers/motion";
import { PAPER_WORDS } from "./recognisers/paper";
import { RESETS_WORDS } from "./recognisers/resets";
import { TIME_WORDS } from "./recognisers/time";
import { WIND_WORDS } from "./recognisers/wind";
import { ATLAS } from "./scenes/atlas";
import { TRAVEL_WORDS } from "./scenes/travel";
import { union, type Vocabulary } from "./vocabulary";

const LETTERS_ONLY = /^[a-z]+$/;

const placeWords = (): readonly string[] =>
  ATLAS.flatMap(({ aliases }) => aliases.flatMap((alias) => alias.split(/\s+/)));

/**
 * Every word the offline grammar reads — the laws, the filler it skips, the places it can take
 * the player and the verbs that ask to go there — as a player would write it.
 */
export const RULE_WORDS: Vocabulary = new Set(
  [
    ...union(
      FILLER,
      DETERMINERS,
      AIR_WORDS,
      BOUNCINESS_WORDS,
      DIAL_WORDS,
      FRICTION_WORDS,
      GRAVITY_WORDS,
      HEED_WORDS,
      MOTION_WORDS,
      PAPER_WORDS,
      RESETS_WORDS,
      TIME_WORDS,
      WIND_WORDS,
      TRAVEL_WORDS,
      placeWords(),
    ),
  ].filter((word) => LETTERS_ONLY.test(word)),
);
