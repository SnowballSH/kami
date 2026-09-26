import { TAG_WORDS, type Tag } from "./lexicon";
import {
  ACCEPTANCE,
  ASK_WHAT_IT_IS,
  forbiddenThingLine,
  MOVING_INK,
  NEAR_ENOUGH,
  pickLine,
  REFUSALS,
  smallestThingLine,
  TAG_LINES,
  TEMPER_LINES,
} from "./lines";
import { motionOf } from "./motion";
import { type NatureMatch, resolveNature } from "./natureResolver";
import { isAllowed } from "./natures";
import { type Phrase, parsePhrase, stemWord } from "./phrase";
import { findRefusal } from "./scriptedRefusals";
import { strengthOf } from "./strength";
import { temperOf } from "./temper";
import { tidyName } from "./tidyName";
import type { AllowedNatures, Ruling } from "./types";

export interface RulingContext {
  readonly allowed: AllowedNatures;
  readonly drawingIsDot: boolean;
}

const PLAIN_STRENGTH = 1;

const tagsIn = (phrase: Phrase): readonly Tag[] =>
  TAG_WORDS.filter((tag) => phrase.stems.includes(stemWord(tag)));

const withMotion = (ruling: Ruling, phrase: Phrase): Ruling => {
  const motion = motionOf(phrase, strengthOf(phrase));
  if (motion === undefined) return ruling;
  const line = ruling.nature === "ink" ? pickLine(MOVING_INK, phrase.text) : ruling.line;
  return { ...ruling, motion, line };
};

export const withTemper = (ruling: Ruling, phrase: Phrase): Ruling => {
  const temper = temperOf(phrase, ruling.nature);
  return temper === undefined
    ? ruling
    : { ...ruling, temper, line: pickLine(TEMPER_LINES[temper], phrase.text) };
};

const plainInk = (name: string, tags: readonly Tag[], line: string): Ruling => ({
  name,
  nature: "ink",
  strength: PLAIN_STRENGTH,
  tags,
  line,
});

const plainLine = (phrase: Phrase, [tag]: readonly Tag[]): string =>
  tag === undefined ? pickLine(ACCEPTANCE.ink, phrase.text) : TAG_LINES[tag];

const forbiddenLine = ({ kind, keyword }: NatureMatch): string =>
  kind === "description" ? REFUSALS.forbidden : forbiddenThingLine(keyword);

const acceptanceLine = (phrase: Phrase, match: NatureMatch, drawingIsDot: boolean): string => {
  if (drawingIsDot && match.kind !== "description") return smallestThingLine(match.keyword);
  if (match.kind === "near-enough") return NEAR_ENOUGH;
  return pickLine(ACCEPTANCE[match.nature], phrase.text);
};

/** Whether the name is one the lexicon has no opinion on, as opposed to one it turned down. */
export const isUnknownName = (utterance: string): boolean => {
  const phrase = parsePhrase(utterance);
  const match = resolveNature(phrase);
  return phrase.words.length > 0 && match === null && findRefusal(phrase, null) === null;
};

export const ruleOn = (utterance: string, { allowed, drawingIsDot }: RulingContext): Ruling => {
  const phrase = parsePhrase(utterance);
  const name = tidyName(utterance);
  if (phrase.words.length === 0) return plainInk(name, [], ASK_WHAT_IT_IS);

  const tags = tagsIn(phrase);
  const match = resolveNature(phrase);
  const refusal = findRefusal(phrase, match);
  if (refusal !== null) return plainInk(name, tags, refusal);
  if (match === null) return withMotion(plainInk(name, tags, plainLine(phrase, tags)), phrase);
  if (!isAllowed(match.nature, allowed)) return plainInk(name, tags, forbiddenLine(match));

  return withTemper(
    withMotion(
      {
        name,
        nature: match.nature,
        strength: strengthOf(phrase),
        tags,
        line: acceptanceLine(phrase, match, drawingIsDot),
      },
      phrase,
    ),
    phrase,
  );
};
