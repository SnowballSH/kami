import { type Amount, readAmount } from "../amounts";
import { DIRECTION_WORDS, type Direction, fieldAlong, readDirection } from "../directions";
import { type BodyScalarGoverns, bodyRule, thrustRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { ALICE } from "../subjects";
import { besides, targetOf } from "../targets";
import { type BodyGoverns, type CompiledRule, STILL, type Target } from "../types";
import {
  INTENSIFIERS,
  mentions,
  NEGATION,
  NORMAL,
  union,
  type Vocabulary,
  vocabulary,
} from "../vocabulary";

interface Reading {
  readonly words: Vocabulary;
  readonly value: number;
}

/** One dial on a body the player can turn by writing about a named drawing or about everything. */
interface BodyDial {
  readonly governs: BodyGoverns;
  readonly about: Vocabulary;
  /** Words that name this dial only beside a heading: "the boat sails to the right". */
  readonly steered?: Vocabulary;
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
const DRIFT = vocabulary(`
  drift, drifts, drifting, drifted, sail, sails, sailing, sailed, roll, rolls, rolling, rolled,
  move, moves, moving, moved, go, goes, going, went, travel, travels, travelling, traveling,
  travelled, traveled, head, heads, heading, headed, glide, glides, gliding, glided, slide, slides,
  sliding, slid, wander, wanders, wandering, wandered, drive, drives, driving, drove, rise, rises,
  rising, rose, sink, sinks, sinking, sank, fall, falls, falling, fell
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
  run, running, walks, walk, walking, moves, move, moving, goes, go, going, sprints, dashes, zippy,
  nimble
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
const GLOW = vocabulary(`
  glow, glows, glowing, glowed, shine, shines, shining, shone, luminous, radiant, gleam, gleams,
  gleaming, lit, illuminated, glimmer, glimmers, glimmering, bioluminescent, phosphorescent
`);
const GLOWING_MANNER = vocabulary("bright, brightly, softly, gently, faintly, dimly, warmly");
const HEADINGS: ReadonlyMap<string, Direction> = new Map([
  ...["rise", "rises", "rising", "rose"].map((word) => [word, "up"] as const),
  ...["sink", "sinks", "sinking", "sank", "fall", "falls", "falling", "fell"].map(
    (word) => [word, "down"] as const,
  ),
]);
const TURNS = vocabulary(
  "turn, turns, revolution, revolutions, rotations, per, second, seconds, rps",
);
const NO_UNITS = vocabulary("");

const HALT = vocabulary("stop, stops, stopped, still, stills, freeze, frozen, halt, halts");
const UNDOING = union(NEGATION, NORMAL);
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
const GLOWS = 1;

const multiplier = (amount: Amount): number | null =>
  amount.unit === "plain" || amount.unit === "multiple" ? amount.value : null;

const knowing = (dial: BodyDial): KnownDial => ({
  ...dial,
  known: knownWords(
    INTENSIFIERS,
    HALT,
    UNDOING,
    BACKWARDS,
    CLOCKWISE,
    FAST,
    SLOW,
    MORE,
    LESS,
    DIRECTION_WORDS,
    dial.about,
    dial.steered ?? [],
    dial.units,
    ...dial.readings.map((reading) => reading.words),
  ),
});

const thrustFromAmount = (amount: Amount): number | null =>
  amount.unit === "mps2" ? null : amount.value;

const DIALS: readonly KnownDial[] = [
  knowing({
    governs: "spin",
    about: SPIN,
    units: TURNS,
    readings: [
      { words: HALT, value: 0 },
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
    steered: DRIFT,
    readings: [
      { words: HALT, value: 0 },
      { words: FAST, value: HARD_THRUST_G },
      { words: SLOW, value: GENTLE_THRUST_G },
    ],
    implied: STEADY_THRUST_G,
    fromAmount: thrustFromAmount,
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
      { words: HALT, value: 0 },
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
    readings: [{ words: HALT, value: 0 }],
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
  knowing({
    governs: "glow",
    units: NO_UNITS,
    about: GLOW,
    readings: [
      { words: HALT, value: 0 },
      { words: GLOWING_MANNER, value: GLOWS },
    ],
    implied: GLOWS,
    fromAmount: ({ value }) => (value === 0 ? 0 : GLOWS),
  }),
  knowing({
    governs: "thrust",
    units: NO_UNITS,
    about: HALT,
    steered: DRIFT,
    readings: [],
    implied: 0,
    fromAmount: thrustFromAmount,
  }),
];

const headingOf = (words: readonly string[]): Direction | null =>
  readDirection(words) ??
  words.map((word) => HEADINGS.get(word)).find((heading) => heading !== undefined) ??
  null;

const isAbout = (dial: BodyDial, words: readonly string[]): boolean =>
  mentions(words, dial.about) ||
  (dial.steered !== undefined && mentions(words, dial.steered) && headingOf(words) !== null);

const ordinary = (governs: BodyGoverns): number => (governs === "thrust" ? 0 : STILL[governs]);

const readDial = (dial: BodyDial, words: readonly string[]): number | null => {
  if (mentions(words, UNDOING)) return ordinary(dial.governs);
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
    return thrustRule(of, fieldAlong(headingOf(words) ?? "right", value));
  }
  const governs: BodyScalarGoverns = dial.governs;
  const sign = governs === "spin" && mentions(words, BACKWARDS) ? -1 : 1;
  return bodyRule(governs, of, sign * value);
};

/**
 * Laws about the bodies on the board rather than the world: "the wheel spins", "every rock is
 * twice as heavy", "the cart accelerates to the left", and the powers a named creature can gain —
 * "the dog can fly", "the cat is twice as fast", "the rabbit is huge", "the firefly glows". Runs after the world's own
 * recognisers, so "everything is bouncy" stays a world law; here a sentence must point at something.
 */
export const recogniseMotion: Recogniser = (sentence) => {
  const { words } = sentence;
  if (mentions(words, ALICE)) return null;
  for (const dial of DIALS) {
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
