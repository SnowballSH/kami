import { createHash } from "node:crypto";
import type { Stroke } from "../../src/core/geometry";
import { isWellFormedDrawing, toStrokes } from "./dataset";
import { computeFeature, FEATURE_LENGTH } from "./feature";
import { allocateFeatureMatrix, type FeatureMatrix } from "./featureMatrix";
import { COMPLETE_FRACTION } from "./prefix";
import { indexedPrefixesOf, prefixFeaturesOf } from "./prefixFeatures";
import type { StoredSketch } from "./snapshotFile";

/** How many drawings of each category are kept for summoning by name; the rest only vote in the k-NN. */
export const SUMMONS_PER_CATEGORY = 24;

/** Bump when the layout of `indexFile.ts` or the choice of summoned drawings changes. */
const INDEX_FORMAT = 1;

/** Each category's most typical well-formed drawings, most typical first. */
export type SummoningShelf = ReadonlyMap<string, readonly StoredSketch[]>;

/** Everything the server derives from the corpus: the k-NN's feature matrix and the drawings it summons. */
export interface CorpusIndex {
  readonly matrix: FeatureMatrix;
  readonly summons: SummoningShelf;
}

const isComplete = (fraction: number): boolean => fraction >= COMPLETE_FRACTION;

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

const rowsOf = (strokes: readonly Stroke[]): { complete: number; partial: number } => {
  const fractions = indexedPrefixesOf(strokes).map(({ fraction }) => fraction);
  const complete = fractions.filter(isComplete).length;
  return { complete, partial: fractions.length - complete };
};

const dot = (matrix: Float32Array, row: number, vector: Float64Array): number => {
  let sum = 0;
  const offset = row * FEATURE_LENGTH;
  for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
    sum += (matrix[offset + cell] ?? 0) * (vector[cell] ?? 0);
  }
  return sum;
};

const categoryCentroids = (
  matrix: FeatureMatrix,
  completeRowOf: readonly (number | undefined)[],
): readonly Float64Array[] => {
  const centroids = matrix.categories.map(() => new Float64Array(FEATURE_LENGTH));
  for (const row of completeRowOf) {
    if (row === undefined) continue;
    const centroid = centroids[matrix.rowCategories[row] ?? 0];
    if (centroid === undefined) continue;
    for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
      centroid[cell] = (centroid[cell] ?? 0) + (matrix.features[row * FEATURE_LENGTH + cell] ?? 0);
    }
  }
  return centroids;
};

/** The drawings closest to their category's mean picture: the cleanest, least surprising ones. */
const pickSummons = (
  sketches: readonly StoredSketch[],
  matrix: FeatureMatrix,
  completeRowOf: readonly (number | undefined)[],
  perCategory: number,
): SummoningShelf => {
  const centroids = categoryCentroids(matrix, completeRowOf);
  const scored = sketches.flatMap((sketch, index) => {
    const row = completeRowOf[index];
    if (row === undefined || !isWellFormedDrawing(sketch.drawing)) return [];
    const centroid = centroids[matrix.rowCategories[row] ?? 0];
    return centroid === undefined
      ? []
      : [{ sketch, typicality: dot(matrix.features, row, centroid) }];
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
 * The same matrix `buildFeatureMatrix` makes from every sketch's prefix features, whole drawings
 * first, but written straight into shared memory: counting the rows first means the features of
 * twelve thousand drawings never exist twice.
 */
export const buildCorpusIndex = (
  sketches: readonly StoredSketch[],
  summonsPerCategory: number = SUMMONS_PER_CATEGORY,
): CorpusIndex => {
  const counts = sketches.map(({ drawing }) => rowsOf(toStrokes(drawing)));
  const completeRows = counts.reduce((sum, { complete }) => sum + complete, 0);
  const partialRows = counts.reduce((sum, { partial }) => sum + partial, 0);
  const categories = [
    ...new Set(
      [...sketches.filter((_, index) => (counts[index]?.complete ?? 0) > 0), ...sketches].map(
        ({ category }) => category,
      ),
    ),
  ];
  const categoryIndex = new Map(categories.map((category, index) => [category, index]));
  const matrix = allocateFeatureMatrix(categories, completeRows + partialRows, completeRows);

  const completeRowOf: (number | undefined)[] = [];
  let nextComplete = 0;
  let nextPartial = completeRows;
  for (const [index, { category, drawing }] of sketches.entries()) {
    for (const { fraction, strokes } of indexedPrefixesOf(toStrokes(drawing))) {
      const row = isComplete(fraction) ? nextComplete++ : nextPartial++;
      if (isComplete(fraction)) completeRowOf[index] = row;
      matrix.features.set(computeFeature(strokes), row * FEATURE_LENGTH);
      matrix.rowCategories[row] = categoryIndex.get(category) ?? 0;
    }
  }
  return {
    matrix,
    summons: pickSummons(sketches, matrix, completeRowOf, summonsPerCategory),
  };
};
