import { type Amount, readAmount } from "../amounts";
import { type ScalarGoverns, scalarRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { ALICE, SUBJECTS } from "../subjects";
import { INTENSIFIERS, mentions, union, type Vocabulary, vocabulary } from "../vocabulary";

interface Reading {
  readonly words: Vocabulary;
  readonly value: number;
}

/**
 * One dial the player can turn by writing: what the sentence must be about, what words set it
 * without a number, and how a stated amount is read. Adding a dial is adding a row here.
 */
interface Dial {
  readonly governs: ScalarGoverns;
  /** Every vocabulary here must be mentioned for the sentence to be about this dial. */
  readonly about: readonly Vocabulary[];
  /** The first reading mentioned wins when no amount is stated. */
  readonly readings: readonly Reading[];
  /** The value when the sentence is about the dial but names neither reading nor amount. */
  readonly implied: number | null;
  readonly fromAmount: (amount: Amount, words: readonly string[]) => number | null;
}

const OFF = vocabulary(`
  cannot, cant, stop, stops, stopped, anymore, longer, grounded, unable, forget, forgets, lose,
  loses, lost
`);
const WINGS = union(
  SUBJECTS.flight,
  vocabulary("airborne, soar, soars, float, floats, floating, flap, flaps"),
);
const PACE = union(
  SUBJECTS.walkSpeed,
  vocabulary(`
    walks, walk, runs, run, running, moves, move, moving, speed, fast, faster, quick, quicker,
    quickly, speedy, rapid, slow, slower, slowly, sluggish, sprint, sprints, dash, dashes
  `),
);
const FAST = vocabulary(`
  fast, faster, quick, quicker, quickly, speedy, rapid, sprint, sprints, dash, dashes
`);
const SLOW = vocabulary("slow, slower, slowly, sluggish");
const BIG = vocabulary(`
  big, bigger, huge, giant, giantess, tall, taller, large, larger, enormous, massive, grow, grows,
  gigantic, colossal
`);
const SMALL = vocabulary(`
  small, smaller, tiny, little, shrink, shrinks, short, shorter, mini, miniature, minuscule, wee
`);
const STATURE = union(SUBJECTS.aliceSize, BIG, SMALL);
const PULL = union(
  SUBJECTS.attraction,
  vocabulary(`
    attracts, attract, attracting, gravitational, gravity, gravitation, magnet, pulls, pulling,
    orbit, orbits, planet, blackhole, sucks, repel, repels, repulsive, repulsion, pushes
  `),
);
const REPEL = vocabulary("repel, repels, repulsive, repulsion, pushes");
const COPIES = union(SUBJECTS.clones, vocabulary("alices"));
const HOT = vocabulary(`
  hot, hotter, heat, heatwave, warm, warmer, boiling, scorching, sweltering, melt, melts,
  melting, burning, tropical
`);
const COLD = vocabulary("cold, colder, freezing, chilly, arctic, antarctic, frozen");
const MORE = vocabulary("increase, increases, raise, raises, higher, up, more");
const LESS = vocabulary("decrease, decreases, lower, lowers, down, less, drop");
const WEATHER = union(SUBJECTS.temperature, HOT, COLD);
const NIGHT = vocabulary("night, nighttime, dark, darkness, midnight, dusk, evening, nightfall");
const DAY = vocabulary("day, dawn, morning, noon, midday, bright, sunrise, sunshine, sunny");
const HOURS = union(SUBJECTS.daylight, NIGHT, DAY);
const SUMMON = vocabulary(`
  summon, summons, summoned, release, released, unleash, unleashed, awaken, awakens, wake, wakes,
  call, calls, invoke, invokes, free, loose, unseal, unsealed, open, opens, come, comes, rise, rises,
  monster, beast, hunger, hungry, eater, devourer, shadow, evil, ancient, old
`);
const BANISH = vocabulary(`
  banish, banished, seal, sealed, sleep, sleeps, gone, leave, leaves, away, begone, vanish,
  vanishes, kill, killed, dead, dies, die, rest, rests, dormant, stop, stops, no, none, without, out, remove
`);

const HOT_DEGREES = 60;
const COLD_DEGREES = -10;
const NIGHT_LIGHT = 0.1;
const FULL_DAY = 1;
const FAST_WALK = 2;
const SLOW_WALK = 0.5;
const BIG_ALICE = 2;
const SMALL_ALICE = 0.5;
const ONE_G = 1;

const asIs = ({ value }: Amount): number => value;

const multiplier = (amount: Amount): number | null =>
  amount.unit === "plain" || amount.unit === "multiple" ? amount.value : null;

const DIALS: readonly Dial[] = [
  {
    governs: "flight",
    about: [ALICE, WINGS],
    readings: [{ words: OFF, value: 0 }],
    implied: 1,
    fromAmount: ({ value }) => (value === 0 ? 0 : 1),
  },
  {
    governs: "walkSpeed",
    about: [ALICE, PACE],
    readings: [
      { words: FAST, value: FAST_WALK },
      { words: SLOW, value: SLOW_WALK },
    ],
    implied: null,
    fromAmount: multiplier,
  },
  {
    governs: "aliceSize",
    about: [ALICE, STATURE],
    readings: [
      { words: BIG, value: BIG_ALICE },
      { words: SMALL, value: SMALL_ALICE },
    ],
    implied: null,
    fromAmount: multiplier,
  },
  {
    governs: "attraction",
    about: [ALICE, PULL],
    readings: [{ words: REPEL, value: -ONE_G }],
    implied: ONE_G,
    fromAmount: (amount, words) =>
      amount.unit === "mps2" ? null : (mentions(words, REPEL) ? -1 : 1) * amount.value,
  },
  {
    governs: "clones",
    about: [COPIES],
    readings: [],
    implied: 1,
    fromAmount: (amount, words) =>
      amount.unit === "plain" ? amount.value - (words.includes("alices") ? 1 : 0) : null,
  },
  {
    governs: "temperature",
    about: [WEATHER],
    readings: [
      { words: HOT, value: HOT_DEGREES },
      { words: COLD, value: COLD_DEGREES },
      { words: MORE, value: HOT_DEGREES },
      { words: LESS, value: COLD_DEGREES },
    ],
    implied: null,
    fromAmount: (amount) => (amount.unit === "plain" ? amount.value : null),
  },
  {
    governs: "inkEater",
    about: [SUBJECTS.inkEater],
    readings: [
      { words: BANISH, value: 0 },
      { words: SUMMON, value: 1 },
    ],
    implied: 1,
    fromAmount: ({ value }) => (value === 0 ? 0 : 1),
  },
  {
    governs: "daylight",
    about: [HOURS],
    readings: [
      { words: NIGHT, value: NIGHT_LIGHT },
      { words: DAY, value: FULL_DAY },
    ],
    implied: null,
    fromAmount: asIs,
  },
];

const knownTo = (dial: Dial): Vocabulary =>
  knownWords(
    ALICE,
    INTENSIFIERS,
    OFF,
    MORE,
    LESS,
    ...dial.about,
    ...dial.readings.map((r) => r.words),
  );

const KNOWN: ReadonlyMap<Dial, Vocabulary> = new Map(DIALS.map((dial) => [dial, knownTo(dial)]));

const readDial = (dial: Dial, words: readonly string[]): number | null => {
  const amount = readAmount(words);
  if (amount !== null) return dial.fromAmount(amount, words);
  const reading = dial.readings.find(({ words: said }) => mentions(words, said));
  return reading === undefined ? dial.implied : reading.value;
};

/** The dials on Alice and on the weather; the older dials keep their own recognisers. */
export const recogniseDials: Recogniser = ({ words }) => {
  for (const dial of DIALS) {
    const known = KNOWN.get(dial);
    if (known === undefined || !understands(words, known)) continue;
    if (!dial.about.every((topic) => mentions(words, topic))) continue;
    const value = readDial(dial, words);
    if (value !== null) return scalarRule(dial.governs, value);
  }
  return null;
};
