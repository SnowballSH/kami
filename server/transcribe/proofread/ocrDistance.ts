/**
 * How far a word the OCR read is from a word the player may have written, counting the edits it
 * would take and charging less for the mistakes handwriting readers make (`m` for `rn`, `d` for
 * `cl`) and for characters the reader was unsure of. See `server/transcribe/PROOFREADING.md`.
 */

/** [read, written, cost]: the reader saw `read` where `written` was written, and vice versa. */
const CONFUSIONS: readonly (readonly [string, string, number])[] = [
  ["m", "n", 0.4],
  ["n", "u", 0.5],
  ["n", "h", 0.5],
  ["n", "r", 0.6],
  ["u", "v", 0.5],
  ["a", "o", 0.5],
  ["a", "u", 0.6],
  ["a", "d", 0.6],
  ["a", "e", 0.6],
  ["e", "c", 0.5],
  ["e", "o", 0.6],
  ["c", "o", 0.6],
  ["i", "l", 0.4],
  ["i", "j", 0.5],
  ["i", "e", 0.6],
  ["l", "t", 0.6],
  ["t", "f", 0.6],
  ["h", "k", 0.6],
  ["h", "b", 0.6],
  ["g", "q", 0.5],
  ["g", "y", 0.6],
  ["s", "z", 0.6],
  ["v", "y", 0.6],
  ["w", "v", 0.6],
  ["m", "rn", 0.3],
  ["m", "nn", 0.4],
  ["m", "in", 0.5],
  ["n", "ri", 0.5],
  ["d", "cl", 0.4],
  ["d", "al", 0.5],
  ["h", "li", 0.5],
  ["u", "ii", 0.5],
  ["w", "vv", 0.4],
  ["w", "iv", 0.6],
  ["k", "lc", 0.5],
];

const EDIT = 1;
/** An edit to a character the reader was sure of costs EDIT; to one it was not, down to this share. */
const UNSURE_SHARE = 0.3;

/** read → written → cost, both ways round. */
const MISREADS: ReadonlyMap<string, ReadonlyMap<string, number>> = (() => {
  const table = new Map<string, Map<string, number>>();
  const add = (read: string, written: string, cost: number): void => {
    const row = table.get(read) ?? new Map<string, number>();
    row.set(written, cost);
    table.set(read, row);
  };
  for (const [read, written, cost] of CONFUSIONS) {
    add(read, written, cost);
    add(written, read, cost);
  }
  return table;
})();

const surenessWeight = (sureness: number): number =>
  UNSURE_SHARE + (1 - UNSURE_SHARE) * Math.min(1, Math.max(0, sureness));

interface Misreading {
  /** How many characters of the reading it takes, and what was written instead. */
  readonly length: number;
  readonly written: string;
  readonly cost: number;
}

/**
 * A word as the reader read it, ready to be measured against many candidate words.
 * `sureness[i]` is how sure the reader was of `read[i]` (1 when unknown).
 */
export class MisreadWord {
  readonly #read: string;
  /** What dropping or changing the character at `i` costs. */
  readonly #changed: Float64Array;
  /** What a character the reader missed just before `i` costs. */
  readonly #missed: Float64Array;
  /** The single characters the one at `i` is often misread for, and what each costs. */
  readonly #swaps: readonly ReadonlyMap<string, number>[];
  /** The misreadings of more than one character that start at `i`. */
  readonly #misreadings: readonly (readonly Misreading[])[];
  #cost = new Float64Array(0);

  constructor(read: string, sureness: readonly number[] = []) {
    const a = read.toLowerCase();
    this.#read = a;
    const sure = (index: number): number =>
      sureness[Math.min(Math.max(index, 0), a.length - 1)] ?? 1;
    const weight = (from: number, length: number): number =>
      surenessWeight(Math.min(...Array.from({ length }, (_, k) => sure(from + k))));
    this.#changed = Float64Array.from({ length: a.length }, (_, i) => EDIT * weight(i, 1));
    this.#missed = Float64Array.from(
      { length: a.length + 1 },
      (_, i) => EDIT * surenessWeight(Math.min(sure(i - 1), sure(i))),
    );
    this.#swaps = Array.from({ length: a.length }, (_, i) => {
      const row = MISREADS.get(a[i] ?? "") ?? new Map<string, number>();
      return new Map(
        [...row].flatMap(([written, share]) =>
          written.length === 1 ? [[written, share * weight(i, 1)] as const] : [],
        ),
      );
    });
    this.#misreadings = Array.from({ length: a.length }, (_, i) =>
      [1, 2].flatMap((length) =>
        i + length > a.length
          ? []
          : [...(MISREADS.get(a.slice(i, i + length)) ?? [])].flatMap(([written, share]) =>
              length === 1 && written.length === 1
                ? []
                : [{ length, written, cost: share * weight(i, length) }],
            ),
      ),
    );
  }

  /** The cheapest way to turn this reading into `written`, or Infinity once past `ceiling`. */
  distanceTo(written: string, ceiling = Number.POSITIVE_INFINITY): number {
    const a = this.#read;
    const b = written.toLowerCase();
    const rows = a.length + 1;
    const columns = b.length + 1;
    if (this.#cost.length < rows * columns) this.#cost = new Float64Array(rows * columns);
    const cost = this.#cost;
    cost.fill(Number.POSITIVE_INFINITY, 0, rows * columns);
    cost[0] = 0;
    let previousRowBest = 0;
    for (let i = 0; i < rows; i++) {
      let rowBest = Number.POSITIVE_INFINITY;
      const changed = this.#changed[i] ?? EDIT;
      const missed = this.#missed[i] ?? EDIT;
      const swaps = this.#swaps[i];
      const misreadings = this.#misreadings[i] ?? [];
      for (let j = 0; j < columns; j++) {
        const at = i * columns + j;
        const here = cost[at] ?? Number.POSITIVE_INFINITY;
        if (here === Number.POSITIVE_INFINITY) continue;
        if (here < rowBest) rowBest = here;
        if (j < b.length && here + missed < (cost[at + 1] ?? 0)) cost[at + 1] = here + missed;
        if (i === a.length) continue;
        const below = at + columns;
        if (here + changed < (cost[below] ?? 0)) cost[below] = here + changed;
        if (j < b.length) {
          const step = a[i] === b[j] ? 0 : (swaps?.get(b[j] ?? "") ?? changed);
          if (here + step < (cost[below + 1] ?? 0)) cost[below + 1] = here + step;
        }
        for (const { length, written: part, cost: step } of misreadings) {
          if (!b.startsWith(part, j)) continue;
          const to = at + length * columns + part.length;
          if (here + step < (cost[to] ?? 0)) cost[to] = here + step;
        }
      }
      if (Math.min(rowBest, previousRowBest) > ceiling) return Number.POSITIVE_INFINITY;
      previousRowBest = rowBest;
    }
    return cost[rows * columns - 1] ?? Number.POSITIVE_INFINITY;
  }
}

export const ocrDistance = (
  read: string,
  written: string,
  sureness: readonly number[] = [],
  ceiling = Number.POSITIVE_INFINITY,
): number => new MisreadWord(read, sureness).distanceTo(written, ceiling);
