import { createHash } from "node:crypto";
import type { Stroke } from "../../src/core/geometry";
import { isWellFormedDrawing, toStrokes } from "./dataset";
import { computeFeature, FEATURE_LENGTH } from "./feature";
import {
  assembleFeatureMatrix,
  type FeatureMatrix,
  featureOfRow,
  SparseRows,
} from "./featureMatrix";
import { COMPLETE_FRACTION } from "./prefix";
import { indexedPrefixesOf, prefixFeaturesOf } from "./prefixFeatures";
import type { StoredSketch } from "./snapshotFile";

/** How many drawings of each category are kept for summoning by name; the rest only vote in the k-NN. */
export const SUMMONS_PER_CATEGORY = 24;

/** Bump when the layout of `indexFile.ts` or the choice of summoned drawings changes. */
const INDEX_FORMAT = 2;

/** Each category's most typical well-formed drawings, most typical first. */
export type SummoningShelf = ReadonlyMap<string, readonly StoredSketch[]>;

/** Everything the server derives from the corpus: the k-NN's feature matrix and the drawings it summons. */
export interface CorpusIndex {
  readonly matrix: FeatureMatrix;
  readonly summons: SummoningShelf;
}

const zigzag = (points: number): Stroke =>
  Array.from({ length: points }, (_, index) => ({ x: index * 7, y: (index % 3) * 40 + index }));

const FINGERPRINT_PROBES: readonly (readonly Stroke[])[] = [
  [zigzag(40)],
  [
    [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ],
    zigzag(9),
    [{ x: 30, y: 200 }],
  ],
  [[]],
];

/**
 * A hash of the features a few fixed drawings get today, so a cached index goes stale by itself
 * the moment `feature.ts` or `prefix.ts` compute anything differently.
 */
const featureFingerprint = (): Uint8Array => {
  const hash = createHash("sha256");
  for (const probe of FINGERPRINT_PROBES) {
    for (const { fraction, feature } of prefixFeaturesOf(probe)) {
      hash.update(String(fraction));
      hash.update(new Uint8Array(feature.buffer, feature.byteOffset, feature.byteLength));
    }
  }
  return hash.digest();
};

/** What a cached index must have been built from to be used: this snapshot, this code. */
export const corpusIndexKey = (snapshot: Uint8Array): string =>
  createHash("sha256")
    .update(`kami-quickdraw-index/${INDEX_FORMAT}/${FEATURE_LENGTH}/${SUMMONS_PER_CATEGORY}/`)
    .update(featureFingerprint())
    .update(snapshot)
    .digest("hex");

const sparseDot = (
  { rowStarts, cells, values }: FeatureMatrix,
  row: number,
  vector: Float64Array,
): number => {
  let sum = 0;
  for (let entry = rowStarts[row] ?? 0; entry < (rowStarts[row + 1] ?? 0); entry += 1) {
    sum += (values[entry] ?? 0) * (vector[cells[entry] ?? 0] ?? 0);
  }
  return sum;
};

const categoryCentroids = (matrix: FeatureMatrix): readonly Float64Array[] => {
  const centroids = matrix.categories.map(() => new Float64Array(FEATURE_LENGTH));
  for (let row = 0; row < matrix.completeRows; row += 1) {
    const centroid = centroids[matrix.rowCategories[row] ?? 0];
    if (centroid === undefined) continue;
    const feature = featureOfRow(matrix, row);
    for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
      centroid[cell] = (centroid[cell] ?? 0) + (feature[cell] ?? 0);
    }
  }
  return centroids;
};

/** The drawings closest to their category's mean picture: the cleanest, least surprising ones. */
const pickSummons = (
  sketches: readonly StoredSketch[],
  matrix: FeatureMatrix,
  perCategory: number,
): SummoningShelf => {
  const centroids = categoryCentroids(matrix);
  const scored = sketches.flatMap((sketch, row) => {
    const centroid = centroids[matrix.rowCategories[row] ?? 0];
    if (centroid === undefined || !isWellFormedDrawing(sketch.drawing)) return [];
    return [{ sketch, typicality: sparseDot(matrix, row, centroid) }];
  });
  const shelf = new Map<string, readonly StoredSketch[]>();
  for (const [category, group] of Map.groupBy(scored, ({ sketch }) => sketch.category)) {
    shelf.set(
      category,
      group
        .sort((a, b) => b.typicality - a.typicality)
        .slice(0, perCategory)
        .map(({ sketch }) => sketch),
    );
  }
  return shelf;
};

/**
 * The matrix `buildFeatureMatrix` makes from every sketch's prefix features, whole drawings first,
 * built one sketch at a time so the dense features of twelve thousand drawings never coexist.
 * Every sketch has exactly one whole-drawing row, so row `i` is sketch `i`.
 */
export const buildCorpusIndex = (
  sketches: readonly StoredSketch[],
  summonsPerCategory: number = SUMMONS_PER_CATEGORY,
): CorpusIndex => {
  const complete = new SparseRows();
  const partial = new SparseRows();
  for (const { category, drawing } of sketches) {
    for (const { fraction, strokes } of indexedPrefixesOf(toStrokes(drawing))) {
      (fraction >= COMPLETE_FRACTION ? complete : partial).push(category, computeFeature(strokes));
    }
  }
  if (complete.categories.length !== sketches.length) {
    throw new Error("PREFIX_FRACTIONS must index every drawing whole");
  }
  const matrix = assembleFeatureMatrix(complete, partial);
  return { matrix, summons: pickSummons(sketches, matrix, summonsPerCategory) };
};
