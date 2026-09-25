import { FEATURE_LENGTH } from "./feature";
import { COMPLETE_FRACTION } from "./prefix";

export interface LabelledFeature {
  readonly category: string;
  readonly feature: Float32Array;
  /** The share of the drawing's points this row was computed from; absent means all of them. */
  readonly fraction?: number;
}

/**
 * Every known sketch feature in one flat matrix, whole drawings first, with each row's category as
 * an index into `categories`. Both arrays sit in shared memory, so worker threads rank against the
 * very same bytes the main thread built: one copy, however many threads.
 */
export interface FeatureMatrix {
  readonly categories: readonly string[];
  readonly rowCategories: Uint16Array;
  readonly features: Float32Array;
  readonly completeRows: number;
}

const isComplete = ({ fraction = COMPLETE_FRACTION }: LabelledFeature): boolean =>
  fraction >= COMPLETE_FRACTION;

/** An all-zero matrix of `rows` rows in shared memory, for a builder or a reader to fill in place. */
export const allocateFeatureMatrix = (
  categories: readonly string[],
  rows: number,
  completeRows: number,
): FeatureMatrix => ({
  categories,
  rowCategories: new Uint16Array(new SharedArrayBuffer(rows * Uint16Array.BYTES_PER_ELEMENT)),
  features: new Float32Array(
    new SharedArrayBuffer(rows * FEATURE_LENGTH * Float32Array.BYTES_PER_ELEMENT),
  ),
  completeRows,
});

export const buildFeatureMatrix = (samples: readonly LabelledFeature[]): FeatureMatrix => {
  const usable = samples.filter(({ feature }) => feature.length === FEATURE_LENGTH);
  const complete = usable.filter(isComplete);
  const ordered = [...complete, ...usable.filter((sample) => !isComplete(sample))];
  const categories = [...new Set(ordered.map(({ category }) => category))];
  const categoryIndex = new Map(categories.map((category, index) => [category, index]));
  const matrix = allocateFeatureMatrix(categories, ordered.length, complete.length);
  for (const [row, { category, feature }] of ordered.entries()) {
    matrix.features.set(feature, row * FEATURE_LENGTH);
    matrix.rowCategories[row] = categoryIndex.get(category) ?? 0;
  }
  return matrix;
};

export const isFeatureMatrix = (
  source: FeatureMatrix | readonly LabelledFeature[],
): source is FeatureMatrix => !Array.isArray(source);
