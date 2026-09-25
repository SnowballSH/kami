import type { FeatureMatrix } from "../quickdraw/featureMatrix";

/** A feature matrix as plain arrays, for comparing two of them in a test. */
export const plainMatrix = ({
  categories,
  completeRows,
  rowCategories,
  rowStarts,
  cells,
  values,
}: FeatureMatrix) => ({
  categories,
  completeRows,
  rowCategories: Array.from(rowCategories),
  rowStarts: Array.from(rowStarts),
  cells: Array.from(cells),
  values: Array.from(values),
});
