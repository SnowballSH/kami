import { NATURE_DESCRIPTIONS, NATURE_THINGS, NEAR_ENOUGH_THINGS, type WordTable } from "./lexicon";
import { ACTIVE_NATURES, type ActiveNature } from "./natures";
import { indexOfSequence, type Phrase, stemsOf } from "./phrase";

export type KeywordKind = "thing" | "description" | "near-enough";

export interface NatureMatch {
  readonly nature: ActiveNature;
  readonly keyword: string;
  readonly kind: KeywordKind;
}

interface IndexedKeyword extends NatureMatch {
  readonly stems: readonly string[];
}

interface Sighting {
  readonly keyword: IndexedKeyword;
  readonly at: number;
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

const outranks = (challenger: Sighting, champion: Sighting): boolean => {
  const lengthGap = challenger.keyword.keyword.length - champion.keyword.keyword.length;
  return lengthGap > 0 || (lengthGap === 0 && challenger.at > champion.at);
};

const strongestOf = (sightings: readonly Sighting[]): IndexedKeyword | null => {
  const [first, ...rest] = sightings;
  if (first === undefined) return null;
  return rest.reduce(
    (champion, challenger) => (outranks(challenger, champion) ? challenger : champion),
    first,
  ).keyword;
};

const sightingsIn = (phrase: Phrase): readonly Sighting[] =>
  KEYWORDS.flatMap((keyword) => {
    const at = indexOfSequence(phrase.stems, keyword.stems);
    return at < 0 ? [] : [{ keyword, at }];
  });

const isDescription = ({ keyword }: Sighting): boolean => keyword.kind === "description";

export const resolveNature = (phrase: Phrase): NatureMatch | null => {
  const sightings = sightingsIn(phrase);
  const things = sightings.filter((sighting) => !isDescription(sighting));
  const verdict = strongestOf(sightings.filter(isDescription)) ?? strongestOf(things);
  if (verdict === null) return null;
  const namesake = strongestOf(things.filter(({ keyword }) => keyword.nature === verdict.nature));
  const { nature, keyword, kind } = namesake ?? verdict;
  return { nature, keyword, kind };
};
