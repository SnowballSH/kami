import { readAmount } from "../amounts";
import { DIRECTION_WORDS } from "../directions";
import { scalarRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { PAPER, SUBJECTS } from "../subjects";
import { INTENSIFIERS, mentions, vocabulary } from "../vocabulary";

const SIDEWAYS_DEGREES = 90;
const FLIPPED_DEGREES = 180;
const LEANING_DEGREES = 30;
const SLOW_SPIN_DPS = 5;
const STEADY_SPIN_DPS = 15;
const FAST_SPIN_DPS = 45;

const DEGREES = vocabulary("degree, degrees, deg");
const PER_SECOND = vocabulary("per, second, seconds, sec, s, dps, rpm");
const UPRIGHT = vocabulary("upright, straight, righted, normal, flat, even, level, untilted");
const STILL = vocabulary("still, stop, stops, stopped, stopping, halt, halts, freeze, no, none");
const FLIPPED = vocabulary("flipped");
const SIDEWAYS = vocabulary("sideways, sideway, sidewards, horizontal");
const WIDDERSHINS = vocabulary(`
  left, leftward, leftwards, counterclockwise, anticlockwise, widdershins, backwards, backward,
  ccw
`);
const CLOCKWISE = vocabulary("clockwise, cw, right, rightward, rightwards");
const FAST = vocabulary("fast, faster, quick, quicker, quickly, rapidly, wildly, madly");
const SLOW = vocabulary("slow, slower, slowly, gently, lazily");
const STARTS = vocabulary("start, starts, begin, begins, keep, keeps");

const KNOWN = knownWords(
  PAPER,
  SUBJECTS.tilt,
  SUBJECTS.worldSpin,
  DEGREES,
  PER_SECOND,
  UPRIGHT,
  STILL,
  DIRECTION_WORDS,
  WIDDERSHINS,
  CLOCKWISE,
  FAST,
  SLOW,
  STARTS,
  INTENSIFIERS,
);

const sign = (words: readonly string[]): number => (mentions(words, WIDDERSHINS) ? -1 : 1);

const spinRate = (words: readonly string[]): number => {
  if (mentions(words, STILL)) return 0;
  if (mentions(words, FAST)) return FAST_SPIN_DPS;
  if (mentions(words, SLOW)) return SLOW_SPIN_DPS;
  return STEADY_SPIN_DPS;
};

const tiltAngle = (words: readonly string[]): number => {
  if (mentions(words, UPRIGHT) || mentions(words, STILL)) return 0;
  if (mentions(words, FLIPPED)) return FLIPPED_DEGREES;
  if (mentions(words, SIDEWAYS)) return SIDEWAYS_DEGREES;
  return LEANING_DEGREES;
};

const restingAngleNamed = (words: readonly string[]): boolean =>
  mentions(words, FLIPPED) || mentions(words, SIDEWAYS) || mentions(words, UPRIGHT);

/**
 * Laws on the page itself: "tilt the world 30°", "the world is sideways", "turn the paper upside
 * down", "the world spins slowly", "stop the world spinning". Spin words keep the page turning
 * unless the sentence names a resting angle, which sets the tilt instead.
 */
export const recognisePaper: Recogniser = ({ words }) => {
  const spinning = mentions(words, SUBJECTS.worldSpin);
  const tilting = mentions(words, SUBJECTS.tilt);
  if (!mentions(words, PAPER) || !(spinning || tilting) || !understands(words, KNOWN)) return null;
  const amount = readAmount(words);
  const stated = amount?.unit === "plain" ? amount.value : null;
  const facing = sign(words);
  if (spinning && stated !== null && mentions(words, PER_SECOND)) {
    return scalarRule("worldSpin", facing * stated);
  }
  if (stated !== null) return scalarRule("tilt", facing * stated);
  if (spinning && !restingAngleNamed(words)) {
    return scalarRule("worldSpin", facing * spinRate(words));
  }
  return scalarRule("tilt", facing * tiltAngle(words));
};
