import {
  type BodyEffect,
  type BodyLaw,
  type Motion,
  type MotionEdit,
  STILL,
  type Target,
} from "./types";

const MIN_STEMMABLE_LENGTH = 4;

const stem = (word: string): string => {
  if (word.length < MIN_STEMMABLE_LENGTH) return word;
  if (/(?:x|ch|sh|ss)es$/.test(word)) return word.slice(0, -2);
  if (/[^su]s$/.test(word)) return word.slice(0, -1);
  return word;
};

const stemsOf = (name: string): readonly string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .map(stem);

/** "the wheels" speaks of "a spinning wheel"; a nameless drawing answers only to `all`. */
export const speaksOf = (target: Target, name: string): boolean =>
  target.kind === "all" || stemsOf(name).includes(stem(target.name));

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
