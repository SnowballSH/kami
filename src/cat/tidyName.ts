import {
  DETERMINERS,
  MASS_NOUNS,
  NATURE_DESCRIPTIONS,
  PREPOSITIONS,
  SELF_STANDING_ENDINGS,
} from "./lexicon";
import { ACTIVE_NATURES } from "./natures";

export const UNNAMED = "a scribble";

const FILLERS = /^(?:(?:um+|uh+|er+|well|okay|ok|maybe|i think|i guess|i say)[,\s]+)*/;
const LEADERS =
  /^(?:(?:it'?s|it is|this is|that'?s|that is|they'?re|they are|these are|those are|i drew|i made|i want|i need|call it|let'?s call it|it looks like|it should be|let it be|make it|(?:make|draw)(?= an? | some )|how about|what about)(?:\s+|$))?/;
const HEDGES = /^(?:(?:called|like|just|obviously|definitely|supposed to be)\s+)*/;
const VOWEL_SOUND = /^(?:[aeio]|u(?!ni|se|ke))/;
const PLURAL = /[^su]s$/;
const MIN_PLURAL_LENGTH = 4;

const DETERMINER_SET = new Set(DETERMINERS);
const MASS_NOUN_SET = new Set(MASS_NOUNS);
const PREPOSITION_SET = new Set(PREPOSITIONS);
const SELF_STANDING_ENDING_SET = new Set(SELF_STANDING_ENDINGS);
const DESCRIPTION_SET = new Set(ACTIVE_NATURES.flatMap((nature) => NATURE_DESCRIPTIONS[nature]));

const clean = (utterance: string): string =>
  utterance
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "")
    .trim();

const stripPreamble = (text: string): string =>
  text.replace(FILLERS, "").replace(LEADERS, "").replace(HEDGES, "").trim();

const headOf = (words: readonly string[]): string => {
  const preposition = words.findIndex((word, i) => i > 0 && PREPOSITION_SET.has(word));
  return (preposition < 0 ? words.at(-1) : words[preposition - 1]) ?? "";
};

const standsWithoutArticle = (words: readonly string[]): boolean => {
  const first = words.at(0) ?? "";
  const head = headOf(words);
  return (
    words.some((word) => DETERMINER_SET.has(word)) ||
    first.endsWith("'s") ||
    /^\d/.test(first) ||
    SELF_STANDING_ENDING_SET.has(words.at(-1) ?? "") ||
    MASS_NOUN_SET.has(head) ||
    (head.length >= MIN_PLURAL_LENGTH && PLURAL.test(head))
  );
};

const withArticle = (name: string): string => {
  const words = name.split(" ");
  if (standsWithoutArticle(words)) return name;
  if (DESCRIPTION_SET.has(words.at(-1) ?? "")) return `something ${name}`;
  return `${VOWEL_SOUND.test(name) ? "an" : "a"} ${name}`;
};

export const tidyName = (utterance: string): string => {
  const name = stripPreamble(clean(utterance));
  return name.length === 0 ? UNNAMED : withArticle(name);
};
