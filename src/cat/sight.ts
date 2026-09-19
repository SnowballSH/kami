import type { Sighting } from "../recognition/types";
import { isAllowed } from "./natures";
import { parsePhrase } from "./phrase";
import { namesForRecognized } from "./recognizedNames";
import type { AllowedNatures, Ruling } from "./types";

/** The server marks the one sighting it would stake a label on. */
export const isCertain = (sighting: Sighting): boolean => sighting.certain;

const honoured = (sighting: Sighting, allowed: AllowedNatures): boolean =>
  sighting.nature === "ink" || isAllowed(sighting.nature, allowed);

/** The best sighting the room would honour, or null when there is nothing worth saying. */
export const bestSighting = (
  sightings: readonly Sighting[],
  allowed: AllowedNatures,
): Sighting | null =>
  sightings.find((sighting) => honoured(sighting, allowed) && namesFor([sighting]).length > 0) ??
  null;

/** The sighting words as names the Cat would say, skipping bare shapes. */
export const namesFor = (sightings: readonly Sighting[]): readonly string[] =>
  namesForRecognized(sightings.map((sighting) => sighting.word));

export const rulingOf = (sighting: Sighting, allowed: AllowedNatures): Ruling => ({
  name: sighting.name,
  nature: honoured(sighting, allowed) ? sighting.nature : "ink",
  strength: sighting.strength,
  tags: [],
  line: sighting.line,
});

const stems = (text: string): ReadonlySet<string> => new Set(parsePhrase(text).stems);

/** Whether what the player wrote is the thing that was seen ("giraffe" ≈ "a tall giraffe"). */
export const speaksOf = (utterance: string, sighting: Sighting): boolean => {
  const said = stems(utterance);
  const seen = [...stems(sighting.word)];
  return seen.length > 0 && seen.every((stem) => said.has(stem));
};
