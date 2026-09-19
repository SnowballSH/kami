import type { Drawing } from "../ink/types";
import { isAllowed } from "./natures";
import { classifyShape, type ShapeKind } from "./shape";
import type { AllowedNatures, Nature } from "./types";

export interface Candidate {
  readonly name: string;
  readonly nature: Nature;
}

export type Guesses = readonly [string, string, string];

export const CANDIDATES: Readonly<Record<ShapeKind, readonly Candidate[]>> = {
  dot: [
    { name: "a bubble", nature: "floaty" },
    { name: "a pebble", nature: "heavy" },
    { name: "a ladder", nature: "climbable" },
    { name: "a biscuit", nature: "grow" },
    { name: "a drop of glue", nature: "sticky" },
    { name: "a button", nature: "ink" },
  ],
  tall: [
    { name: "a ladder", nature: "climbable" },
    { name: "a bottle", nature: "shrink" },
    { name: "a rope", nature: "climbable" },
    { name: "a nail", nature: "sticky" },
    { name: "a tree", nature: "climbable" },
    { name: "a post", nature: "ink" },
  ],
  flat: [
    { name: "a plank", nature: "ink" },
    { name: "a trampoline", nature: "bouncy" },
    { name: "a cloud", nature: "floaty" },
    { name: "a biscuit", nature: "grow" },
    { name: "a bridge", nature: "ink" },
    { name: "a bar of soap", nature: "slippery" },
  ],
  round: [
    { name: "a mushroom", nature: "bouncy" },
    { name: "a cake", nature: "grow" },
    { name: "a balloon", nature: "floaty" },
    { name: "a bottle", nature: "shrink" },
    { name: "a rock", nature: "heavy" },
    { name: "a ball", nature: "bouncy" },
  ],
  blob: [
    { name: "a mushroom", nature: "bouncy" },
    { name: "a cake", nature: "grow" },
    { name: "a cloud", nature: "floaty" },
    { name: "a bottle", nature: "shrink" },
    { name: "a rock", nature: "heavy" },
    { name: "a box", nature: "ink" },
  ],
};

const EVERY_CANDIDATE: readonly Candidate[] = Object.values(CANDIDATES).flat();
const LAST_RESORT: Guesses = ["a plank", "a box", "a button"];

export const guessNames = (drawing: Drawing, allowed: AllowedNatures): Guesses => {
  const ranked = [...CANDIDATES[classifyShape(drawing)], ...EVERY_CANDIDATE];
  const permitted = ranked.filter(({ nature }) => isAllowed(nature, allowed));
  const forbidden = ranked.filter(({ nature }) => !isAllowed(nature, allowed));
  const [first, second, third] = new Set([...permitted, ...forbidden].map(({ name }) => name));
  return [first ?? LAST_RESORT[0], second ?? LAST_RESORT[1], third ?? LAST_RESORT[2]];
};
