import type { Sighting } from "../recognition/types";
import { REFUSALS } from "./lines";
import { isAllowed } from "./natures";
import { parsePhrase } from "./phrase";
import { namesForRecognized } from "./recognizedNames";
import type { AllowedNatures, Ruling } from "./types";

/** The server marks the one sighting it would stake a label on. */
export const isCertain = (sighting: Sighting): boolean => sighting.certain;

const honoured = (sighting: Sighting, allowed: AllowedNatures): boolean =>
  sighting.nature === "ink" || isAllowed(sighting.nature, allowed);

const canOffer = (sighting: Sighting, allowed: AllowedNatures): boolean =>
  honoured(sighting, allowed) && namesForRecognized([sighting.word]).length > 0;

/** The best sighting the room would honour, or null when there is nothing worth saying. */
export const bestSighting = (
  sightings: readonly Sighting[],
  allowed: AllowedNatures,
): Sighting | null => sightings.find((sighting) => canOffer(sighting, allowed)) ?? null;

export const offeredRulings = (
  sightings: readonly Sighting[],
  allowed: AllowedNatures,
): readonly Ruling[] =>
  sightings
    .filter((sighting) => canOffer(sighting, allowed))
    .map((sighting) => rulingOf(sighting, allowed));

export const honourRuling = (ruling: Ruling, allowed: AllowedNatures): Ruling =>
  ruling.nature === "ink" || isAllowed(ruling.nature, allowed)
    ? ruling
    : { ...ruling, nature: "ink", strength: 1, line: REFUSALS.forbidden };

export const rulingOf = (sighting: Sighting, allowed: AllowedNatures): Ruling =>
  honourRuling(
    {
      name: sighting.name,
      nature: sighting.nature,
      strength: sighting.strength,
      tags: [],
      line: sighting.line,
    },
    allowed,
  );

const stems = (text: string): ReadonlySet<string> => new Set(parsePhrase(text).stems);

/** Whether what the player wrote is the thing that was seen ("giraffe" ≈ "a tall giraffe"). */
export const speaksOf = (utterance: string, sighting: Sighting): boolean => {
  const said = stems(utterance);
  const seen = [...stems(sighting.word)];
  return seen.length > 0 && seen.every((stem) => said.has(stem));
};
