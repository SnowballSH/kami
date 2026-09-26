import { type NatureMatch, resolveNature } from "../cat/natureResolver";
import { isCreature } from "../cat/natures";
import { parsePhrase, stemWord, vocabulary } from "../cat/phrase";
import { headIndexOf } from "../rules/referents";

const ARTICLES = /^(?:a|an|the|my|our|this|that|little|small|big|tall|tiny|brave|new)\s+/;

/** Bodies the Cat's lexicon has no creature for: people, roles, and figures with a shape to wear. */
const BODY_NOUNS = vocabulary(
  `body figure person people human self soul avatar character player hero heroine champion fighter
  warrior knight wizard witch mage princess prince queen king girl boy man woman lady guy kid child
  baby doll puppet robot android golem ghost spirit angel fairy elf dwarf giant monster creature
  beast animal cat dog fox wolf bear rabbit bunny mouse bird owl dragon dinosaur lizard frog fish
  octopus spider bug bee butterfly stickman snowman scarecrow alien demon devil vampire zombie
  skeleton mermaid unicorn pony horse deer lion tiger monkey ape penguin duck chicken pig cow sheep
  goat catgirl teddy`.split(/\s+/),
);

/** Compounds the lexicon reads as things, but which are figures a spirit can wear, like a doll. */
const BODY_COMPOUNDS: ReadonlySet<string> = new Set([
  "teddy bear",
  "rag doll",
  "toy soldier",
  "tin man",
  "gingerbread man",
  "action figure",
  "stick figure",
]);

const PLAYER_WORDS = vocabulary(
  "me myself her him them you us i she he they herself himself themselves".split(" "),
);

const PRONOUN =
  /^(?:(?:this|that|it) ?i?s )?(?:me|myself|her|him|them|you|us|i|she|he|they|herself|himself|themselves)$/;

const LONGEST_KEYWORD_WORDS = 3;

const tidy = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[.!?,;:"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

const stripped = (text: string): string => tidy(text).replace(ARTICLES, "");

/**
 * The Cat's reading of the thing a name's head noun belongs to, the longest keyword that ends on
 * it: "hot dog" for "a hot dog", "firefly" for "a bouncy firefly", "trap" for "a bear trap".
 */
const thingEndingAt = (words: readonly string[], head: number): NatureMatch | null => {
  for (let start = Math.max(0, head + 1 - LONGEST_KEYWORD_WORDS); start <= head; start++) {
    const span = words.slice(start, head + 1);
    const match = resolveNature(parsePhrase(span.join(" ")));
    if (match !== null && match.kind !== "description" && match.end === span.length) return match;
  }
  return null;
};

/** Whether the head noun is a creature by the Cat's lexicon, a body noun, and not a compound thing. */
const isBodyNoun = (words: readonly string[], head: number): boolean => {
  const thing = thingEndingAt(words, head);
  if (thing !== null && isCreature(thing.nature)) return true;
  if (BODY_COMPOUNDS.has(words.slice(Math.max(0, head - 1), head + 1).join(" "))) return true;
  const compound = thing !== null && thing.end - thing.at > 1;
  const stem = words[head];
  return !compound && stem !== undefined && BODY_NOUNS.has(stemWord(stem));
};

/**
 * Whether a name given to a drawing means "this is her body": one of the mode's own names or a
 * pronoun for the player — alone or as the head of the name ("Princess Alice", "alice on a
 * horse") — or a name whose head noun is a body: a creature to the Cat, a person, a doll. A body
 * word that only qualifies another noun ("a bear trap", "a bed for a cat") names that other
 * thing, and so does a compound the Cat reads as something else ("a hot dog", "the rabbit hole").
 */
export const namesABody = (name: string, names: readonly string[]): boolean => {
  const whole = tidy(name);
  const plain = stripped(name);
  if (plain === "") return false;
  if (names.some((known) => tidy(known) === plain)) return true;
  if (PRONOUN.test(whole) || PRONOUN.test(plain)) return true;
  const { words, stems } = parsePhrase(plain);
  const at = headIndexOf(stems);
  const head = stems[at];
  if (head === undefined) return false;
  if (vocabulary(names.map(tidy)).has(head) || PLAYER_WORDS.has(head)) return true;
  return isBodyNoun(words, at);
};
