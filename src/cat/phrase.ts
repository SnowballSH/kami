export interface Phrase {
  readonly words: readonly string[];
  readonly stems: readonly string[];
  readonly text: string;
}

const MIN_STEMMABLE_LENGTH = 4;

export const stemWord = (word: string): string => {
  if (word.length < MIN_STEMMABLE_LENGTH) return word;
  if (/(?:x|ch|sh|ss)es$/.test(word)) return word.slice(0, -2);
  if (/[^su]s$/.test(word)) return word.slice(0, -1);
  return word;
};

export const tokenize = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

export const stemsOf = (text: string): readonly string[] => tokenize(text).map(stemWord);

export const parsePhrase = (utterance: string): Phrase => {
  const words = tokenize(utterance);
  return { words, stems: words.map(stemWord), text: words.join(" ") };
};

export const indexOfSequence = (haystack: readonly string[], needle: readonly string[]): number =>
  needle.length === 0
    ? -1
    : haystack.findIndex((_, start) => needle.every((word, i) => haystack[start + i] === word));

export const vocabulary = (words: readonly string[]): ReadonlySet<string> =>
  new Set(words.map(stemWord));

export const countMentions = (phrase: Phrase, vocab: ReadonlySet<string>): number =>
  phrase.stems.filter((stem) => vocab.has(stem)).length;

export const mentions = (phrase: Phrase, vocab: ReadonlySet<string>): boolean =>
  countMentions(phrase, vocab) > 0;
