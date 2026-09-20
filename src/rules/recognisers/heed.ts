import { bodyRule } from "../effects";
import { knownWords, type Recogniser, understands } from "../recogniser";
import { ALICE } from "../subjects";
import { besides, targetOf } from "../targets";
import { mentions, union, vocabulary } from "../vocabulary";

const FOLLOWS = vocabulary(`
  follows, follow, following, followed, chases, chase, chasing, chased, tails, trails, shadows,
  stalks, hunts, tags, sticks, heels, heel, accompanies, escorts, guards, protects, loyal, faithful,
  friendly, tame, tamed, obedient, devoted, clingy, trusty, companion, sidekick, pet, likes, loves,
  adores, befriends, befriended
`);

const FLEES = vocabulary(`
  flees, flee, fleeing, fled, avoids, avoid, avoiding, fears, fear, afraid, scared, frightened,
  terrified, shy, timid, skittish, nervous, wary, hides, hide, hiding, escapes, escape, dodges,
  dodge, away, hates, dislikes
`);

const ALONE = vocabulary(`
  alone, indifferent, wild, wanders, wander, roams, roam, roaming, ignores, ignore, ignoring,
  ignored, forget, forgets, forgets
`);

const NEGATION = vocabulary(`
  not, no, never, dont, doesnt, wont, stops, stop, stopped, quits, quit, longer, anymore
`);

const ME = union(ALICE, vocabulary("me, us, alice"));

const GOING = vocabulary(`
  runs, run, running, goes, go, going, walks, walk, hops, flies, moves, comes, come, gets,
  keeps, keep, stays, stay, leaves, leave, backs, back, close, near, nearby, distance, off, from,
  out, behind, around, after, about, everywhere, wherever, side, always, forever, terribly,
  everyone, whenever, sees, around, toward, towards, along, far
`);

const KNOWN = knownWords(FOLLOWS, FLEES, ALONE, NEGATION, ME, GOING);

const HEED = union(FOLLOWS, FLEES, ALONE);

const heedOf = (words: readonly string[]): number => {
  if (mentions(words, NEGATION) || mentions(words, ALONE)) return 0;
  return mentions(words, FLEES) ? -1 : 1;
};

const firstIndex = (words: readonly string[], among: ReadonlySet<string>): number =>
  words.findIndex((word) => among.has(word));

/**
 * "The cat chases me", "the dog follows Alice", "the mouse runs away from her", "the dog is loyal",
 * "the cat leaves me alone": how a named drawing takes to Alice. The drawing must be the one doing
 * the taking, so "Alice chases the cat" is left for someone else to read.
 */
export const recogniseHeed: Recogniser = (sentence) => {
  const { words } = sentence;
  if (!mentions(words, HEED)) return null;
  const of = targetOf(sentence, KNOWN);
  if (of === null) return null;
  const her = firstIndex(words, ME);
  if (of.kind === "named" && her >= 0 && words.indexOf(of.name) > her) return null;
  const rest = besides(words, of);
  if (!understands(rest, KNOWN)) return null;
  return bodyRule("heed", of, heedOf(rest));
};
