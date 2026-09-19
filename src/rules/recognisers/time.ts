import { readAmount } from "../amounts";
import { scalarRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { SUBJECTS } from "../subjects";
import { mentions, UNIVERSAL, vocabulary } from "../vocabulary";

const SLOW_TIME = 0.5;
const FAST_TIME = 2;
const STOPPED_TIME = 0.1;
const REAL_TIME = 1;

const NAMED_PACES: ReadonlyMap<string, number> = new Map([
  ["slowmo", SLOW_TIME],
  ["bullettime", 0.25],
  ["fastforward", FAST_TIME],
]);
const PACE_NAMES = new Set(NAMED_PACES.keys());
const SLOW = vocabulary("slow, slower, slowly, slowed, slows, sluggish");
const FAST = vocabulary("fast, faster, quick, quicker, quickly, speedy, sped");
const STOPPED = vocabulary("freeze, freezes, frozen, stop, stops, stopped, pause, paused, halt");
const PASSING = vocabulary(`
  runs, run, running, passes, pass, passing, goes, go, going, moves, move, moving, flows, flow,
  down, up, motion, game, playback, rate
`);

const KNOWN = knownWords(SUBJECTS.timeScale, PACE_NAMES, SLOW, FAST, STOPPED, PASSING);

const speedsUp = (words: readonly string[]): boolean =>
  mentions(words, FAST) || (words.includes("speed") && words.includes("up"));

const readPace = (words: readonly string[]): number | null => {
  const named = words.map((word) => NAMED_PACES.get(word)).find((pace) => pace !== undefined);
  if (named !== undefined) return named;
  if (mentions(words, STOPPED)) return STOPPED_TIME;
  if (mentions(words, SLOW)) return SLOW_TIME;
  return speedsUp(words) ? FAST_TIME : null;
};

const isAboutTime = (words: readonly string[], pace: number | null): boolean =>
  mentions(words, SUBJECTS.timeScale) ||
  mentions(words, PACE_NAMES) ||
  (pace !== null && mentions(words, UNIVERSAL));

export const recogniseTime: Recogniser = ({ words }) => {
  if (!understands(words, KNOWN)) return null;
  const pace = readPace(words);
  if (!isAboutTime(words, pace)) return null;
  const amount = readAmount(words);
  if (amount === null) return pace === null ? null : scalarRule("timeScale", pace);
  if (amount.unit === "g" || amount.unit === "mps2") return null;
  return scalarRule("timeScale", amount.value === 0 && pace !== null ? REAL_TIME : amount.value);
};
