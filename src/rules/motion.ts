import {
  type BodyEffect,
  type BodyLaw,
  type Motion,
  type MotionEdit,
  STILL,
  type Target,
} from "./types";

const MIN_STEMMABLE_LENGTH = 4;

/** What a word could be in the singular: "buses" is "bus" or "buse", "puppies" is "puppy". */
const singularsOf = (word: string): ReadonlySet<string> => {
  if (word.length < MIN_STEMMABLE_LENGTH) return new Set([word]);
  return new Set([
    word,
    ...(/[^su]s$/.test(word) ? [word.slice(0, -1)] : []),
    ...(/(?:s|x|z|ch|sh)es$/.test(word) ? [word.slice(0, -2)] : []),
    ...(word.endsWith("ies") ? [`${word.slice(0, -3)}y`] : []),
  ]);
};

const wordsOf = (name: string): readonly ReadonlySet<string>[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .map(singularsOf);

const sameWord = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  [...a].some((form) => b.has(form));

const namedBy = (phrase: string, name: string): boolean => {
  const wanted = wordsOf(phrase);
  const given = wordsOf(name);
  return wanted.length > 0 && wanted.every((word) => given.some((its) => sameWord(word, its)));
};

/** "the wheels" speaks of "a spinning wheel"; a nameless drawing answers only to `all`. */
export const speaksOf = (target: Target, name: string): boolean =>
  target.kind === "all" || namedBy(target.name, name);

export const editOf = (effect: BodyEffect): MotionEdit =>
  effect.governs === "thrust"
    ? { thrust: { x: effect.x, y: effect.y } }
    : { [effect.governs]: effect.value };

export const lawOf = (effect: BodyEffect): BodyLaw => ({ of: effect.of, edit: editOf(effect) });

/** What a drawing called `name` does: its own motion, then every standing law that speaks of it. */
export const motionOf = (own: MotionEdit, laws: readonly BodyLaw[], name: string): Motion => {
  const edits = laws.filter((law) => speaksOf(law.of, name)).map((law) => law.edit);
  return Object.assign({}, STILL, own, ...edits);
};

export const isStill = (motion: Motion): boolean =>
  motion.spin === 0 && motion.thrust.x === 0 && motion.thrust.y === 0;
