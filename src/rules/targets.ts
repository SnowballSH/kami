import { isNumeral } from "./amounts";
import type { Sentence } from "./normalise";
import type { Target } from "./types";
import { mentions, UNIVERSAL, type Vocabulary } from "./vocabulary";

const isNamingWord = (word: string, known: Vocabulary): boolean =>
  !known.has(word) && !isNumeral(word);

/** "the lily pads drift left": the pointed-at word and the unknown words right after it. */
const phraseFrom = (words: readonly string[], head: string, known: Vocabulary): string[] => {
  const at = words.indexOf(head);
  const after = at < 0 ? [] : words.slice(at + 1);
  const end = after.findIndex((word) => !isNamingWord(word, known));
  return [head, ...(end < 0 ? after : after.slice(0, end))];
};

/** The drawing the sentence points at with "the"/"every"; failing that, everything, if it says so. */
export const targetOf = ({ words, subjects }: Sentence, known: Vocabulary): Target | null => {
  const head = subjects.find((subject) => isNamingWord(subject, known));
  if (head !== undefined) return { kind: "named", name: phraseFrom(words, head, known).join(" ") };
  return mentions(words, UNIVERSAL) ? { kind: "all" } : null;
};

export const wordsNaming = (of: Target): readonly string[] =>
  of.kind === "named" ? of.name.split(" ") : [];

/** The sentence's words with the named target taken out, so the rest can be read as the law. */
export const besides = (words: readonly string[], of: Target): readonly string[] => {
  const naming = wordsNaming(of);
  return words.filter((word) => !naming.includes(word));
};
