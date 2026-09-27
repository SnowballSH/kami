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

/** Words that end a doing, so a negation before one says the doing goes on: "doesn't stop". */
const HALTING = vocabulary(`
  stop, stops, stopped, stopping, quit, quits, quitting, cease, ceases, ceased, halt, halts,
  halted, lose, loses, lost, forget, forgets
`);

/**
 * "the lamp doesn't stop glowing", "Alice never stops flying": a negated halt says the doing goes
 * on, so the sentence reads as its affirmative ("the lamp glowing"). Null when it has no such pair.
 */
export const affirmed = (words: readonly string[]): readonly string[] | null =>
  mentions(words, NEGATION) && mentions(words, HALTING)
    ? words.filter((word) => !NEGATION.has(word) && !HALTING.has(word))
    : null;

/** Words that ask for a dial's ordinary value: "the dog is normal size", "Alice walks normally". */
export const NORMAL = vocabulary(`
  normal, normally, regular, usual, usually, ordinary, default, standard, average
`);

/** Words that say when, how steadily or in what mood, and change nothing a law can hold: "the rock suddenly floats". */
export const STEADINESS = vocabulary(`
  always, forever, constantly, continually, continuously, endlessly, eternally, permanently,
  suddenly, instantly, immediately, again, finally, eventually, gradually, happily, merrily,
  quietly, silently, calmly, proudly, peacefully, magically, mysteriously, simply, truly, actually,
  loudly, noisily, boldly, bravely, sadly, gladly, sleepily, wildly, madly, cheerfully,
  carefully, curiously, politely, joyfully, gracefully, clumsily, eagerly, secretly, sweetly
`);

/** Words that ask for only some of a quality: "the ball is barely bouncy", "a bit heavier". */
export const SLIGHTLY = vocabulary("barely, slightly, bit, somewhat, kinda, mildly, tad");

/** Words that say how often or how much, which the grammar cannot keep: "the wheel sometimes spins". */
const HEDGES = vocabulary(`
  sometimes, often, occasionally, rarely, seldom, usually, soon, later, quite, rather, almost,
  nearly, hardly, mostly, only, even, already, ever
`);

/** Words that describe a sentence rather than name a drawing, so a name never runs on into them. */
export const QUALIFIERS = union(STEADINESS, SLIGHTLY, HEDGES, INTENSIFIERS, NEGATION, NORMAL);
