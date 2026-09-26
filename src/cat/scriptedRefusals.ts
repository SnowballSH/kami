import {
  ALICE_ABILITIES,
  ALICE_GADGETS,
  ALICE_NAMES,
  ALICE_REWRITE_VERBS,
  ALICE_SUBJECTS,
  KEY_WORDS,
  ROOM_NOUNS,
  ROOM_VERBS,
  WEAPON_WORDS,
} from "./lexicon";
import { REFUSALS } from "./lines";
import type { WordSpan } from "./natureResolver";
import { type Phrase, vocabulary } from "./phrase";

const anyOf = (words: readonly string[]): string => `(?:${words.join("|")})`;

const ALICE = anyOf(ALICE_NAMES);
const MENTIONS_ALICE = new RegExp(`\\b${ALICE}\\b`);
const REWRITES_ALICE = new RegExp(
  `\\b${anyOf(ALICE_REWRITE_VERBS)} ${ALICE} (?!an? |the |some )\\w+`,
);
const ALICE_ACTS = new RegExp(`\\b${anyOf(ALICE_SUBJECTS)} ${anyOf(ALICE_ABILITIES)}\\b`);
const WEARS_GADGET = new RegExp(`\\b${anyOf(ALICE_GADGETS)}\\b`);
const REWRITES_ROOM = new RegExp(
  `\\b${anyOf(ROOM_VERBS)} (?:(?:the|this|that) )?${anyOf(ROOM_NOUNS)}s?\\b`,
);

const KEY_VOCAB = vocabulary(KEY_WORDS);
const WEAPON_VOCAB = vocabulary(WEAPON_WORDS);

const aimedAtAlice = ({ text }: Phrase, named: WordSpan | null): boolean =>
  WEARS_GADGET.test(text) ||
  REWRITES_ALICE.test(text) ||
  ALICE_ACTS.test(text) ||
  (MENTIONS_ALICE.test(text) && named === null);

/** Whether a word from `vocab` is said outside the thing named: "fruit punch" is only a drink. */
const mentionsBesides = (
  { stems }: Phrase,
  vocab: ReadonlySet<string>,
  named: WordSpan | null,
): boolean =>
  stems.some((stem, i) => vocab.has(stem) && (named === null || i < named.at || i >= named.end));

/** The authored refusal the phrase earns, if any; `named` is where it names something real. */
export const findRefusal = (phrase: Phrase, named: WordSpan | null): string | null => {
  if (aimedAtAlice(phrase, named)) return REFUSALS.alice;
  if (REWRITES_ROOM.test(phrase.text)) return REFUSALS.room;
  if (mentionsBesides(phrase, KEY_VOCAB, named)) return REFUSALS.key;
  if (mentionsBesides(phrase, WEAPON_VOCAB, named)) return REFUSALS.weapon;
  return null;
};
