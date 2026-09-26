import {
  NATURE_DESCRIPTIONS,
  NATURE_THINGS,
  NEAR_ENOUGH_THINGS,
  PLAIN_THINGS,
  type WordTable,
} from "./lexicon";
import { ACTIVE_NATURES, type ActiveNature, isCreature } from "./natures";
import { indexOfSequence, type Phrase, stemsOf } from "./phrase";

export type KeywordKind = "thing" | "description" | "near-enough";

/** Where in the phrase's words a keyword was heard: `at` inclusive, `end` exclusive. */
export interface WordSpan {
  readonly at: number;
  readonly end: number;
}

export interface NatureMatch extends WordSpan {
  readonly nature: ActiveNature;
  readonly keyword: string;
  readonly kind: KeywordKind;
}

interface IndexedKeyword {
  readonly nature: ActiveNature;
  readonly keyword: string;
  readonly kind: KeywordKind;
  readonly stems: readonly string[];
}

interface Sighting extends WordSpan {
  readonly keyword: IndexedKeyword;
}

const indexTable = (table: Readonly<Partial<WordTable>>, kind: KeywordKind): IndexedKeyword[] =>
  ACTIVE_NATURES.flatMap((nature) =>
    (table[nature] ?? []).map((keyword) => ({ nature, keyword, kind, stems: stemsOf(keyword) })),
  );

export const KEYWORDS: readonly IndexedKeyword[] = [
  ...indexTable(NATURE_THINGS, "thing"),
  ...indexTable(NATURE_DESCRIPTIONS, "description"),
  ...indexTable(NEAR_ENOUGH_THINGS, "near-enough"),
];

const PLAIN_STEMS: readonly (readonly string[])[] = PLAIN_THINGS.map(stemsOf);

const spansOf = (phrase: Phrase, stems: readonly string[]): WordSpan[] => {
  const at = indexOfSequence(phrase.stems, stems);
  return at < 0 ? [] : [{ at, end: at + stems.length }];
};

const within = (inner: WordSpan, outer: WordSpan): boolean =>
  outer.at <= inner.at && inner.end <= outer.end && outer.end - outer.at > inner.end - inner.at;

const outranks = (challenger: Sighting, champion: Sighting): boolean => {
  const lengthGap = challenger.keyword.keyword.length - champion.keyword.keyword.length;
  return lengthGap > 0 || (lengthGap === 0 && challenger.at > champion.at);
};

const strongestOf = (sightings: readonly Sighting[]): Sighting | null => {
  const [first, ...rest] = sightings;
  if (first === undefined) return null;
  return rest.reduce(
    (champion, challenger) => (outranks(challenger, champion) ? challenger : champion),
    first,
  );
};

const isDescription = ({ keyword }: Sighting): boolean => keyword.kind === "description";

const isGlowing = ({ keyword }: Sighting): boolean =>
  keyword.kind === "description" && keyword.nature === "lantern";

/** "A glowing dog" is a dog that glows (a power, read by `motionOf`), not a lantern shaped like one. */
const glowAsPower = (sightings: readonly Sighting[]): readonly Sighting[] =>
  sightings.some(({ keyword }) => isCreature(keyword.nature))
    ? sightings.filter((sighting) => !isGlowing(sighting))
    : sightings;

/**
 * Every keyword heard, less the ones that are only part of a longer name: "bat" in a plain
 * "baseball bat", or the "light" in "a traffic light", which is no adjective there.
 */
const sightingsIn = (phrase: Phrase): readonly Sighting[] => {
  const heard = KEYWORDS.flatMap((keyword) =>
    spansOf(phrase, keyword.stems).map((span) => ({ ...span, keyword })),
  );
  const plain = PLAIN_STEMS.flatMap((stems) => spansOf(phrase, stems));
  const things = heard.filter((sighting) => !isDescription(sighting));
  return heard.filter(
    (sighting) =>
      !plain.some((span) => within(sighting, span)) &&
      !(isDescription(sighting) && things.some((thing) => within(sighting, thing))),
  );
};

export const resolveNature = (phrase: Phrase): NatureMatch | null => {
  const sightings = glowAsPower(sightingsIn(phrase));
  const things = sightings.filter((sighting) => !isDescription(sighting));
  const verdict = strongestOf(sightings.filter(isDescription)) ?? strongestOf(things);
  if (verdict === null) return null;
  const namesake = strongestOf(
    things.filter(({ keyword }) => keyword.nature === verdict.keyword.nature),
  );
  const { at, end, keyword } = namesake ?? verdict;
  return { nature: keyword.nature, keyword: keyword.keyword, kind: keyword.kind, at, end };
};
