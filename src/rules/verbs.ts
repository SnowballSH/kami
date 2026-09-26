import { type Vocabulary, vocabulary } from "./vocabulary";

const SIBILANT = /(?:s|sh|ch|x|z|o)$/;
const CONSONANT_Y = /[^aeiou]y$/;
const SILENT_E = /[^aeiou]e$/;
const SHORT_CLOSED = /^[^aeiou]*[aeiou][^aeiouwxy]$/;

const doubled = (stem: string): string => (SHORT_CLOSED.test(stem) ? stem + stem.at(-1) : stem);

const presentOf = (stem: string): string => {
  if (CONSONANT_Y.test(stem)) return `${stem.slice(0, -1)}ies`;
  return SIBILANT.test(stem) ? `${stem}es` : `${stem}s`;
};

const progressiveOf = (stem: string): string => {
  if (stem.endsWith("ie")) return `${stem.slice(0, -2)}ying`;
  if (SILENT_E.test(stem)) return `${stem.slice(0, -1)}ing`;
  return `${doubled(stem)}ing`;
};

const pastOf = (stem: string): string => {
  if (stem.endsWith("e")) return `${stem}d`;
  if (CONSONANT_Y.test(stem)) return `${stem.slice(0, -1)}ied`;
  return `${doubled(stem)}ed`;
};

/** A verb as a drawing's subject would be followed by it: "fly, flies, flying, flied". */
const inflections = (stem: string): readonly string[] => [
  stem,
  presentOf(stem),
  progressiveOf(stem),
  pastOf(stem),
];

/**
 * What players write their drawings doing. Words that as often end a two-word name are left out on
 * purpose — "leaves", "swing", "shake", "skate", "bark", "rose", "fell" — so "the tree swing" and
 * "the milk shake" keep their names.
 */
const STEMS = vocabulary(`
  fly, soar, glide, float, hover, levitate, flap, flutter, buzz, drift, sail, roll, move, go,
  travel, slide, wander, drive, rise, sink, fall, spin, rotate, revolve, whirl, twirl, gyrate,
  glow, shine, gleam, glimmer, sparkle, twinkle, flicker, bounce, run, walk, hop, jump, leap,
  swim, crawl, creep, climb, slither, gallop, trot, sprint, zoom, hurry, rush, skip, paddle,
  dance, sit, stand, stay, hold, sleep, wait, lie, hang, stop, freeze, halt, follow, chase, flee,
  hide, escape, dodge, avoid, fear, ignore, roam, like, love, hate, sing, eat, grow, shrink,
  accelerate, push, pull, carry, ride, explode, weigh, keep, come, slip, melt, burn, fade,
  vanish, appear, sway, wobble, tremble, chirp, quack, roar, growl, hiss
`);

/** Past forms no rule builds from a stem. */
const IRREGULAR = vocabulary(`
  flew, flown, swam, swum, ran, drove, driven, went, gone, rode, ridden, slid, spun, shone, held,
  grew, grown, shrank, shrunk, sank, sunk, crept, fled, hid, hidden, leapt, sprang, sprung, swung,
  froze, frozen, sat, stood, slept, ate, eaten, blew, blown, kept, came, stuck, fallen, risen
`);

/**
 * Words that say what a drawing does, in the forms that follow its name: "the bird *flies*
 * slowly", "the fish *swims*", "the clouds *drift* away". A name never runs on into one.
 */
export const VERBS: Vocabulary = new Set([...[...STEMS].flatMap(inflections), ...IRREGULAR]);
