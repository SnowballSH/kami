import { parsePhrase, vocabulary } from "../cat/phrase";
import { headOf } from "../rules/referents";

const ARTICLES = /^(?:a|an|the|my|our|this|that|little|small|big|tall|tiny|brave|new)\s+/;

const BODY_NOUNS = vocabulary(
  `body figure person people human self soul avatar character player hero heroine champion fighter
  warrior knight wizard witch mage princess prince queen king girl boy man woman lady guy kid child
  baby doll puppet robot android golem ghost spirit angel fairy elf dwarf giant monster creature
  beast animal cat dog fox wolf bear rabbit bunny mouse bird owl dragon dinosaur lizard frog fish
  octopus spider bug bee butterfly stickman snowman scarecrow alien demon devil vampire zombie
  skeleton mermaid unicorn pony horse deer lion tiger monkey ape penguin duck chicken pig cow sheep
  goat catgirl`.split(/\s+/),
);

const PRONOUN =
  /^(?:(?:this|that|it) ?i?s )?(?:me|myself|her|him|them|you|us|i|she|he|they|herself|himself|themselves)$/;

const tidy = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[.!?,;:"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

const stripped = (text: string): string => tidy(text).replace(ARTICLES, "");

/**
 * Whether a name given to a drawing means "this is her body": one of the mode's own names, a
 * pronoun for the player, or a name whose head noun is a body — a person, a creature, a doll —
 * since anything with a shape can be a body for a soul to wear. A body word that only qualifies
 * another noun ("a bear trap", "the rabbit hole") names that other thing.
 */
export const namesABody = (name: string, names: readonly string[]): boolean => {
  const whole = tidy(name);
  const plain = stripped(name);
  if (plain === "") return false;
  if (names.some((known) => tidy(known) === plain)) return true;
  if (PRONOUN.test(whole) || PRONOUN.test(plain)) return true;
  const head = headOf(parsePhrase(plain).stems);
  return head !== undefined && BODY_NOUNS.has(head);
};
