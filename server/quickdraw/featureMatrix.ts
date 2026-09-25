import { FEATURE_LENGTH } from "./feature";
import { COMPLETE_FRACTION } from "./prefix";

export interface LabelledFeature {
  readonly category: string;
  readonly feature: Float32Array;
  /** The share of the drawing's points this row was computed from; absent means all of them. */
  readonly fraction?: number;
}

/**
 * Every known sketch feature, whole drawings first, with each row's category as an index into
 * `categories`. A feature is mostly empty paper, so only its non-zero cells are kept: row `r` is
 * `cells`/`values` from `rowStarts[r]` up to `rowStarts[r + 1]`, cells ascending. Features are
 * never negative, so a dot product over those cells alone, in that order, is bit for bit the dense
 * one: every skipped term would have added zero. Every array sits in shared memory, so worker
 * threads rank against the very bytes the main thread built.
 */
export interface FeatureMatrix {
  readonly categories: readonly string[];
  readonly completeRows: number;
  readonly rowCategories: Uint16Array;
  readonly rowStarts: Uint32Array;
  readonly cells: Uint16Array;
  readonly values: Float32Array;
}

export interface FeatureMatrixShape {
  readonly categories: readonly string[];
  readonly completeRows: number;
  readonly rows: number;
  readonly nonZero: number;
}

const sharedArray = <T>(
  make: new (buffer: SharedArrayBuffer) => T,
  length: number,
  bytesPerElement: number,
): T => new make(new SharedArrayBuffer(length * bytesPerElement));

/** An all-zero matrix of the given shape in shared memory, for a builder or a reader to fill in place. */
export const allocateFeatureMatrix = ({
  categories,
  completeRows,
  rows,
  nonZero,
}: FeatureMatrixShape): FeatureMatrix => ({
  categories,
  completeRows,
  rowCategories: sharedArray(Uint16Array, rows, Uint16Array.BYTES_PER_ELEMENT),
  rowStarts: sharedArray(Uint32Array, rows + 1, Uint32Array.BYTES_PER_ELEMENT),
  cells: sharedArray(Uint16Array, nonZero, Uint16Array.BYTES_PER_ELEMENT),
  values: sharedArray(Float32Array, nonZero, Float32Array.BYTES_PER_ELEMENT),
});

export const rowCountOf = ({ rowCategories }: FeatureMatrix): number => rowCategories.length;

/** One row as the whole feature it was built from. */
export const featureOfRow = (
  { rowStarts, cells, values }: FeatureMatrix,
  row: number,
): Float32Array => {
  const feature = new Float32Array(FEATURE_LENGTH);
  for (let entry = rowStarts[row] ?? 0; entry < (rowStarts[row + 1] ?? 0); entry += 1) {
    feature[cells[entry] ?? 0] = values[entry] ?? 0;
  }
  return feature;
};

const grown = <T extends Uint16Array | Float32Array>(array: T, needed: number): T => {
  if (needed <= array.length) return array;
  const larger = new (array.constructor as new (length: number) => T)(
    Math.max(needed, array.length * 2),
  );
  larger.set(array);
  return larger;
};

/** Rows collected one at a time, in order, before they are laid out in shared memory. */
export class SparseRows {
  readonly categories: string[] = [];
  #starts: number[] = [0];
  #cells = new Uint16Array(FEATURE_LENGTH);
  #values = new Float32Array(FEATURE_LENGTH);

  get nonZero(): number {
    return this.#starts.at(-1) ?? 0;
  }

  push(category: string, feature: Float32Array): void {
    let end = this.nonZero;
    this.#cells = grown(this.#cells, end + FEATURE_LENGTH);
    this.#values = grown(this.#values, end + FEATURE_LENGTH);
    for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
      const value = feature[cell] ?? 0;
      if (value === 0) continue;
      this.#cells[end] = cell;
      this.#values[end] = value;
      end += 1;
    }
    this.#starts.push(end);
    this.categories.push(category);
  }

  /** Copies the rows into `matrix` from `firstRow` on, their entries after those of the rows before. */
  copyInto(
    matrix: FeatureMatrix,
    firstRow: number,
    categoryIndex: ReadonlyMap<string, number>,
  ): void {
    const firstEntry = matrix.rowStarts[firstRow] ?? 0;
    matrix.cells.set(this.#cells.subarray(0, this.nonZero), firstEntry);
    matrix.values.set(this.#values.subarray(0, this.nonZero), firstEntry);
    for (const [index, category] of this.categories.entries()) {
      matrix.rowCategories[firstRow + index] = categoryIndex.get(category) ?? 0;
      matrix.rowStarts[firstRow + index + 1] = firstEntry + (this.#starts[index + 1] ?? 0);
    }
  }
}

/** Whole drawings first, then the prefixes; categories in the order the rows first name them. */
export const assembleFeatureMatrix = (complete: SparseRows, partial: SparseRows): FeatureMatrix => {
  const categories = [...new Set([...complete.categories, ...partial.categories])];
  const matrix = allocateFeatureMatrix({
    categories,
    completeRows: complete.categories.length,
    rows: complete.categories.length + partial.categories.length,
    nonZero: complete.nonZero + partial.nonZero,
  });
  const categoryIndex = new Map(categories.map((category, index) => [category, index]));
  complete.copyInto(matrix, 0, categoryIndex);
  partial.copyInto(matrix, complete.categories.length, categoryIndex);
  return matrix;
};

const isComplete = ({ fraction = COMPLETE_FRACTION }: LabelledFeature): boolean =>
  fraction >= COMPLETE_FRACTION;

export const buildFeatureMatrix = (samples: readonly LabelledFeature[]): FeatureMatrix => {
  const complete = new SparseRows();
  const partial = new SparseRows();
  for (const sample of samples) {
    if (sample.feature.length !== FEATURE_LENGTH) continue;
    (isComplete(sample) ? complete : partial).push(sample.category, sample.feature);
  }
  return assembleFeatureMatrix(complete, partial);
};

export const isFeatureMatrix = (
  source: FeatureMatrix | readonly LabelledFeature[],
): source is FeatureMatrix => !Array.isArray(source);
