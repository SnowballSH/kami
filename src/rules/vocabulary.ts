export type Vocabulary = ReadonlySet<string>;

export const vocabulary = (csv: string): Vocabulary =>
  new Set(
    csv
      .split(",")
      .map((word) => word.trim())
      .filter((word) => word.length > 0),
  );

export const union = (...vocabularies: readonly Iterable<string>[]): Vocabulary =>
  new Set(vocabularies.flatMap((words) => [...words]));

export const UNIVERSAL = vocabulary(`
  everything, everywhere, everyone, world, universe, all, every, whole, entire, global, globally,
  anything
`);

const SCOPE_NOUNS = vocabulary("thing, things, object, objects, stuff, board, place");

export const SCOPE = union(UNIVERSAL, SCOPE_NOUNS);

export const INTENSIFIERS = vocabulary("very, super, really, extra, extremely, totally");

export const mentions = (words: readonly string[], vocab: Vocabulary): boolean =>
  words.some((word) => vocab.has(word));

/** Words that take a quality back: "the rock is not heavy", "Alice isn't big anymore". */
export const NEGATION = vocabulary(`
  not, never, isnt, arent, wasnt, werent, aint, dont, doesnt, didnt, wont, cannot, cant, anymore
`);

/** Words that ask for a dial's ordinary value: "the dog is normal size", "Alice walks normally". */
export const NORMAL = vocabulary(`
  normal, normally, regular, usual, usually, ordinary, default, standard, average
`);
