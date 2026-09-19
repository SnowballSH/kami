import { type AllowedNatures, NATURES, type Nature } from "./types";

export type ActiveNature = Exclude<Nature, "ink">;

export const ACTIVE_NATURES: readonly ActiveNature[] = NATURES.filter(
  (nature): nature is ActiveNature => nature !== "ink",
);

export const isAllowed = (nature: Nature, allowed: AllowedNatures): boolean =>
  allowed === "all" || allowed.includes(nature);
