import { isNumeral } from "./amounts";
import type { Sentence } from "./normalise";
import type { Target } from "./types";
import { mentions, UNIVERSAL, type Vocabulary } from "./vocabulary";

/** The drawing the sentence points at with "the"/"every"; failing that, everything, if it says so. */
export const targetOf = ({ words, subjects }: Sentence, known: Vocabulary): Target | null => {
  const name = subjects.find((subject) => !known.has(subject) && !isNumeral(subject));
  if (name !== undefined) return { kind: "named", name };
  return mentions(words, UNIVERSAL) ? { kind: "all" } : null;
};

/** The sentence's words with the named target taken out, so the rest can be read as the law. */
export const besides = (words: readonly string[], of: Target): readonly string[] =>
  of.kind === "named" ? words.filter((word) => word !== of.name) : words;
