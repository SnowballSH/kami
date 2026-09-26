import type { Proofread, ProofreadWord } from "./corrector";
import { Lexicon, type WordKind } from "./lexicon";

/** A small lexicon for the proofreading tests: a few game words, some English, one rare word. */
export const TEST_LEXICON = new Lexicon(
  ["summon", "the", "sumikui", "alice", "gravity", "mars", "like", "a", "rabbit", "is", "moon"],
  ["photo", "robot", "friend", "made"],
  ["doleful"],
);

export const wordOf = (
  text: string,
  sureness = 0.95,
  kind: WordKind | null = TEST_LEXICON.kindOf(text),
): ProofreadWord => ({ read: text, text, sureness, kind, nearby: [] });

export const proofreadOf = (
  words: readonly ProofreadWord[],
  alternatives: readonly string[] = [],
): Proofread => {
  const text = words.map(({ text: word }) => word).join(" ");
  return { read: text, text, words, alternatives };
};
