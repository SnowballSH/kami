import { type Amount, isNumeral, readAmount } from "../amounts";
import { DIRECTION_WORDS, fieldAlong, readDirection } from "../directions";
import { type BodyScalarGoverns, bodyRule, thrustRule } from "../effects";
import type { Sentence } from "../normalise";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { ALICE } from "../subjects";
import type { BodyGoverns, CompiledRule, Target } from "../types";
import { INTENSIFIERS, mentions, UNIVERSAL, type Vocabulary, vocabulary } from "../vocabulary";

interface Reading {
  readonly words: Vocabulary;
  readonly value: number;
}

/** One dial on a body the player can turn by writing about a named drawing or about everything. */
interface BodyDial {
  readonly governs: BodyGoverns;
  readonly about: Vocabulary;
  readonly units: Vocabulary;
  readonly readings: readonly Reading[];
  readonly implied: number | null;
  readonly fromAmount: (amount: Amount) => number | null;
}

interface KnownDial extends BodyDial {
  readonly known: Vocabulary;
}

const SPIN = vocabulary(`
  spin, spins, spinning, spun, rotate, rotates, rotating, rotation, revolve, revolves, revolving,
  whirl, whirls, whirling, twirl, twirls, twirling, turning, gyrate, gyrates
`);
const THRUST = vocabulary(`
  accelerate, accelerates, accelerating, accelerated, acceleration, thrust, thrusts, thrusting,
  propelled, propel, propels, propulsion, powered, motorised, motorized, boost, boosts, boosted,
  zoom, zooms, zooming, thrusters, jetpack
`);
const WEIGHT = vocabulary(`
  heavy, heavier, heaviest, heavyweight, weight, weighs, weigh, weighty, mass, massive, dense,
  denser, light, lighter, lightest, lightweight, weightless
`);
const BOUNCE = vocabulary(`
  bouncy, bouncey, bouncier, bounciest, bounce, bounces, bouncing, springy, rubbery, elastic
`);
const GRIP = vocabulary(`
  slippery, slippy, slick, icy, frictionless, greasy, oily, soapy, buttery, sticky, grippy, grip,
  grips, rough, tacky, gluey, friction, traction, smooth
`);

const PACE = vocabulary(`
  fast, faster, fastest, quick, quicker, quickest, quickly, speedy, speedier, rapid, rapidly, swift,
  swifter, swiftly, slow, slower, slowest, slowly, sluggish, speed, pace, hurries, hurry, runs,
  sprints, dashes, zippy, nimble
`);
const WINGS = vocabulary(`
  fly, flies, flying, flew, flight, wings, winged, soar, soars, soaring, hover, hovers, hovering,
  airborne, levitate, levitates, levitating, glide, glides, gliding, float, floats, floating
`);
const STATURE = vocabulary(`
  big, bigger, biggest, huge, giant, enormous, gigantic, colossal, large, larger, largest, tall,
  taller, grow, grows, grown, small, smaller, smallest, tiny, little, mini, miniature, minuscule,
  wee, shrink, shrinks, shrunk, size, sized
`);
const TURNS = vocabulary(
  "turn, turns, revolution, revolutions, rotations, per, second, seconds, rps",
);
const NO_UNITS = vocabulary("");

const STOP = vocabulary(`
  stop, stops, stopped, still, stills, freeze, frozen, halt, halts, not, never, dont, doesnt,
  cannot, cant, anymore, longer, no, none, off, without
`);
const BACKWARDS = vocabulary(`
  counterclockwise, anticlockwise, widdershins, backwards, backward, reverse, reversed
`);
const CLOCKWISE = vocabulary("clockwise, forwards, forward");
const FAST = vocabulary(`
  fast, faster, fastest, quick, quicker, quickest, quickly, rapid, rapidly, speedy, speedier, swift,
  swifter, swiftly, zippy, nimble, hurries, hurry, sprints, dashes
`);
const SLOW = vocabulary("slow, slower, slowest, slowly, sluggish, gently, lazily");
const HEAVY = vocabulary("heavy, heavier, heaviest, heavyweight, weighty, massive, dense, denser");
const LIGHT = vocabulary("light, lighter, lightest, lightweight");
const WEIGHTLESS = vocabulary("weightless");
const SLIPPERY = vocabulary(
  "slippery, slippy, slick, icy, frictionless, greasy, oily, soapy, buttery, smooth",
);
const GRIPPY = vocabulary("sticky, grippy, rough, tacky, gluey");
const BIG = vocabulary(`
  big, bigger, biggest, huge, giant, enormous, gigantic, colossal, large, larger, largest, tall,
  taller, grow, grows, grown
`);
const SMALL = vocabulary(`
  small, smaller, smallest, tiny, little, mini, miniature, minuscule, wee, shrink, shrinks, shrunk
`);
const MORE = vocabulary("more, higher, increase, increases, increased, doubled");
const LESS = vocabulary("less, lower, decrease, decreases, decreased, halved");

const ONE_TURN_PER_SECOND = 1;
const FAST_SPIN = 2;
const SLOW_SPIN = 0.5;
const STEADY_THRUST_G = 0.5;
const HARD_THRUST_G = 1;
const GENTLE_THRUST_G = 0.2;
const HEAVIER = 2;
const LIGHTER = 0.5;
const NEAR_WEIGHTLESS = 0.1;
const BOUNCY = 0.8;
const VERY_BOUNCY = 1;
const NO_GRIP = 0;
const STICKY_GRIP = 3;
const MORE_GRIP = 2.5;
const LESS_GRIP = 0.3;
const QUICK = 2;
const SLUGGISH = 0.5;
const CAN_FLY = 1;
const HUGE = 2;
const TINY = 0.5;

const multiplier = (amount: Amount): number | null =>
  amount.unit === "plain" || amount.unit === "multiple" ? amount.value : null;

const knowing = (dial: BodyDial): KnownDial => ({
  ...dial,
  known: knownWords(
    INTENSIFIERS,
    STOP,
    BACKWARDS,
    CLOCKWISE,
    FAST,
    SLOW,
    MORE,
    LESS,
    DIRECTION_WORDS,
    dial.about,
    dial.units,
    ...dial.readings.map((reading) => reading.words),
  ),
});

const DIALS: readonly KnownDial[] = [
  knowing({
    governs: "spin",
    about: SPIN,
    units: TURNS,
    readings: [
      { words: STOP, value: 0 },
      { words: FAST, value: FAST_SPIN },
      { words: SLOW, value: SLOW_SPIN },
    ],
    implied: ONE_TURN_PER_SECOND,
    fromAmount: multiplier,
  }),
  knowing({
    governs: "thrust",
    units: NO_UNITS,
    about: THRUST,
    readings: [
      { words: STOP, value: 0 },
      { words: FAST, value: HARD_THRUST_G },
      { words: SLOW, value: GENTLE_THRUST_G },
    ],
    implied: STEADY_THRUST_G,
    fromAmount: (amount) => (amount.unit === "mps2" ? null : amount.value),
  }),
  knowing({
    governs: "mass",
    units: NO_UNITS,
    about: WEIGHT,
    readings: [
      { words: WEIGHTLESS, value: NEAR_WEIGHTLESS },
      { words: HEAVY, value: HEAVIER },
      { words: LIGHT, value: LIGHTER },
      { words: MORE, value: HEAVIER },
      { words: LESS, value: LIGHTER },
    ],
    implied: null,
    fromAmount: multiplier,
  }),
  knowing({
    governs: "bounce",
    units: NO_UNITS,
    about: BOUNCE,
    readings: [
      { words: STOP, value: 0 },
      { words: INTENSIFIERS, value: VERY_BOUNCY },
    ],
    implied: BOUNCY,
    fromAmount: multiplier,
  }),
  knowing({
    governs: "grip",
    units: NO_UNITS,
    about: GRIP,
    readings: [
      { words: SLIPPERY, value: NO_GRIP },
      { words: GRIPPY, value: STICKY_GRIP },
      { words: MORE, value: MORE_GRIP },
      { words: LESS, value: LESS_GRIP },
    ],
    implied: null,
    fromAmount: multiplier,
  }),
  knowing({
    governs: "pace",
    units: NO_UNITS,
    about: PACE,
    readings: [
      { words: FAST, value: QUICK },
      { words: SLOW, value: SLUGGISH },
      { words: MORE, value: QUICK },
      { words: LESS, value: SLUGGISH },
    ],
    implied: null,
    fromAmount: multiplier,
  }),
  knowing({
    governs: "wings",
    units: NO_UNITS,
    about: WINGS,
    readings: [{ words: STOP, value: 0 }],
    implied: CAN_FLY,
    fromAmount: ({ value }) => (value === 0 ? 0 : CAN_FLY),
  }),
  knowing({
    governs: "size",
    units: NO_UNITS,
    about: STATURE,
    readings: [
      { words: BIG, value: HUGE },
      { words: SMALL, value: TINY },
      { words: MORE, value: HUGE },
      { words: LESS, value: TINY },
    ],
    implied: null,
    fromAmount: multiplier,
  }),
];

/** The drawing the sentence points at with "the"/"every"; failing that, everything, if it says so. */
const targetOf = ({ words, subjects }: Sentence, known: Vocabulary): Target | null => {
  const name = subjects.find((subject) => !known.has(subject) && !isNumeral(subject));
  if (name !== undefined) return { kind: "named", name };
  return mentions(words, UNIVERSAL) ? { kind: "all" } : null;
};

const readDial = (dial: BodyDial, words: readonly string[]): number | null => {
  const amount = readAmount(words);
  if (amount !== null) return dial.fromAmount(amount);
  const reading = dial.readings.find(({ words: said }) => mentions(words, said));
  return reading === undefined ? dial.implied : reading.value;
};

const ruleFor = (
  dial: BodyDial,
  of: Target,
  value: number,
  words: readonly string[],
): CompiledRule => {
  if (dial.governs === "thrust") {
    return thrustRule(of, fieldAlong(readDirection(words) ?? "right", value));
  }
  const governs: BodyScalarGoverns = dial.governs;
  const sign = governs === "spin" && mentions(words, BACKWARDS) ? -1 : 1;
  return bodyRule(governs, of, sign * value);
};

/**
 * Laws about the bodies on the board rather than the world: "the wheel spins", "every rock is
 * twice as heavy", "the cart accelerates to the left", and the powers a named creature can gain —
 * "the dog can fly", "the cat is twice as fast", "the rabbit is huge". Runs after the world's own
 * recognisers, so "everything is bouncy" stays a world law; here a sentence must point at something.
 */
export const recogniseMotion: Recogniser = (sentence) => {
  const { words } = sentence;
  if (mentions(words, ALICE)) return null;
  for (const dial of DIALS) {
    if (!mentions(words, dial.about)) continue;
    const of = targetOf(sentence, dial.known);
    if (of === null) return null;
    const rest = of.kind === "named" ? words.filter((word) => word !== of.name) : words;
    if (!understands(rest, dial.known)) continue;
    const value = readDial(dial, rest);
    if (value !== null) return ruleFor(dial, of, value, rest);
  }
  return null;
};
