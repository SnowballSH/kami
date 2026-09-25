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

const shared = <T extends Float32Array | Uint16Array>(
  make: (buffer: SharedArrayBuffer) => T,
  bytes: number,
): T => make(new SharedArrayBuffer(bytes));

export const buildFeatureMatrix = (samples: readonly LabelledFeature[]): FeatureMatrix => {
  const usable = samples.filter(({ feature }) => feature.length === FEATURE_LENGTH);
  const complete = usable.filter(isComplete);
  const ordered = [...complete, ...usable.filter((sample) => !isComplete(sample))];
  const categories = [...new Set(ordered.map(({ category }) => category))];
  const categoryIndex = new Map(categories.map((category, index) => [category, index]));
  const features = shared(
    (buffer) => new Float32Array(buffer),
    ordered.length * FEATURE_LENGTH * Float32Array.BYTES_PER_ELEMENT,
  );
  const rowCategories = shared(
    (buffer) => new Uint16Array(buffer),
    ordered.length * Uint16Array.BYTES_PER_ELEMENT,
  );
  for (const [row, { category, feature }] of ordered.entries()) {
    features.set(feature, row * FEATURE_LENGTH);
    rowCategories[row] = categoryIndex.get(category) ?? 0;
  }
  return { categories, rowCategories, features, completeRows: complete.length };
};

export const isFeatureMatrix = (
  source: FeatureMatrix | readonly LabelledFeature[],
): source is FeatureMatrix => !Array.isArray(source);
