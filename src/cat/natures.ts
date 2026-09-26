import { type AllowedNatures, NATURES, type Nature } from "./types";

export type ActiveNature = Exclude<Nature, "ink">;

export const ACTIVE_NATURES: readonly ActiveNature[] = NATURES.filter(
  (nature): nature is ActiveNature => nature !== "ink",
);

const CREATURES: ReadonlySet<Nature> = new Set<Nature>(["walker", "hopper", "flier"]);

/** The natures that move of themselves and have a mind: walkers, hoppers and fliers. */
export const isCreature = (nature: Nature): boolean => CREATURES.has(nature);

export const isAllowed = (nature: Nature, allowed: AllowedNatures): boolean =>
  allowed === "all" || allowed.includes(nature);
