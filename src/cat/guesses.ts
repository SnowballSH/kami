import { resolveNature } from "./natureResolver";
import { isAllowed } from "./natures";
import { parsePhrase } from "./phrase";
import type { Guesses } from "./shapeGuesser";
import type { AllowedNatures } from "./types";

const wouldBeHonoured = (name: string, allowed: AllowedNatures): boolean => {
  const nature = resolveNature(parsePhrase(name))?.nature ?? "ink";
  return nature === "ink" || isAllowed(nature, allowed);
};

/** What was seen comes first, in order; the geometric hunch fills whatever is left of three. */
export const mergeGuesses = (
  seen: readonly string[],
  hunch: Guesses,
  allowed: AllowedNatures,
): Guesses => {
  const honoured = seen.filter((name) => wouldBeHonoured(name, allowed));
  const [first, second, third] = new Set([...honoured, ...hunch]);
  return [first ?? hunch[0], second ?? hunch[1], third ?? hunch[2]];
};
