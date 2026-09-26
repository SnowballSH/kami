/** Plain edit distance as a share of the longer word: 0 the same, 1 nothing alike. */
export const differenceShare = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 0;
  let row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return (row[y.length] ?? longest) / longest;
};

/** Words this far apart or further are not two readings of one word. */
const UNRELATED = 0.75;
const SKIP = 1;
/** Reading two words as one costs this much more than reading one as one. */
const MERGED = 0.6;
/** Two lone symbols ("-" and "=") may well be two readings of one mark. */
const SYMBOLS_APART = 0.5;

const isSymbol = (word: string): boolean => !/[\p{L}\p{N}]/u.test(word);

const readingCost = (word: string, reading: string): number => {
  const share =
    isSymbol(word) && isSymbol(reading)
      ? SYMBOLS_APART
      : differenceShare(word, reading.replaceAll(" ", ""));
  return share < UNRELATED ? share : Number.POSITIVE_INFINITY;
};

/**
 * What the other reading made of each word of `words`: one of its words, two of its words where
 * this reading ran them together ("clonealice" / "clone alice"), or undefined where it has none.
 * The cheapest alignment, skipping a word on either side at a cost of one.
 */
export const alignWords = (
  words: readonly string[],
  other: readonly string[],
): readonly (string | undefined)[] => {
  const columns = other.length + 1;
  const cost = new Float64Array((words.length + 1) * columns);
  const at = (i: number, j: number): number => cost[i * columns + j] ?? 0;
  const one = (i: number, j: number): number => readingCost(words[i - 1] ?? "", other[j - 1] ?? "");
  const two = (i: number, j: number): number =>
    j < 2
      ? Number.POSITIVE_INFINITY
      : MERGED + readingCost(words[i - 1] ?? "", other.slice(j - 2, j).join(" "));
  for (let i = 0; i <= words.length; i++) {
    for (let j = 0; j <= other.length; j++) {
      cost[i * columns + j] =
        i === 0 || j === 0
          ? (i + j) * SKIP
          : Math.min(
              at(i - 1, j) + SKIP,
              at(i, j - 1) + SKIP,
              at(i - 1, j - 1) + one(i, j),
              j >= 2 ? at(i - 1, j - 2) + two(i, j) : Number.POSITIVE_INFINITY,
            );
    }
  }
  const aligned: (string | undefined)[] = words.map(() => undefined);
  let i = words.length;
  let j = other.length;
  while (i > 0 && j > 0) {
    if (at(i, j) === at(i - 1, j - 1) + one(i, j)) {
      aligned[i - 1] = other[j - 1];
      i -= 1;
      j -= 1;
    } else if (j >= 2 && at(i, j) === at(i - 1, j - 2) + two(i, j)) {
      aligned[i - 1] = other.slice(j - 2, j).join(" ");
      i -= 1;
      j -= 2;
    } else if (at(i, j) === at(i - 1, j) + SKIP) i -= 1;
    else j -= 1;
  }
  return aligned;
};
