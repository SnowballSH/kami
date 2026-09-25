import type { Stroke } from "../../src/core/geometry";
import { floorFor } from "../recognition/certainty";
import type { CertaintyFloors, RankedCategory, RankOptions, Reading } from "../recognition/types";
import { computeFeature } from "./feature";
import {
  buildFeatureMatrix,
  type FeatureMatrix,
  isFeatureMatrix,
  type LabelledFeature,
  rowCountOf,
} from "./featureMatrix";

export type { FeatureMatrix, LabelledFeature, RankedCategory, RankOptions };

export interface RecognizerOptions {
  readonly neighbours: number;
  readonly voteSharpness: number;
  readonly confidenceFloor: number;
  readonly similarityFloor: number;
  readonly partialLeaderFloor: number;
  readonly maxGuesses: number;
  /** The leading vote share from which a drawing may be named without asking; null where the share cannot be trusted. */
  readonly certainAbove: CertaintyFloors;
}

export const DEFAULT_RECOGNIZER_OPTIONS: RecognizerOptions = {
  neighbours: 15,
  voteSharpness: 8,
  confidenceFloor: 0.08,
  similarityFloor: 0.35,
  partialLeaderFloor: 0.6,
  maxGuesses: 3,
  certainAbove: { finished: 0.8, partial: null },
};

/** What any sketch recogniser, local or remote, looks like to the route. */
export interface AsyncSketchRecognizer {
  rank(strokes: readonly Stroke[], options?: RankOptions): Promise<readonly RankedCategory[]>;
}

interface Neighbour {
  readonly index: number;
  readonly similarity: number;
}

const insertNeighbour = (nearest: Neighbour[], candidate: Neighbour, capacity: number): void => {
  const position = nearest.findIndex((held) => candidate.similarity > held.similarity);
  if (position === -1 && nearest.length >= capacity) return;
  nearest.splice(position === -1 ? nearest.length : position, 0, candidate);
  if (nearest.length > capacity) nearest.pop();
};

/**
 * Which of the scored categories are worth saying aloud. A finished drawing always gets its best
 * guesses; one still under the pen gets none until the leader is sure enough to be right most of the time.
 */
export const statedGuesses = (
  scored: readonly RankedCategory[],
  partial: boolean,
  options: RecognizerOptions = DEFAULT_RECOGNIZER_OPTIONS,
): readonly RankedCategory[] => {
  const leader = scored[0];
  if (leader === undefined) return [];
  if (partial && leader.confidence < options.partialLeaderFloor) return [];
  return scored
    .filter(({ confidence }) => confidence >= options.confidenceFloor)
    .slice(0, options.maxGuesses);
};

/**
 * Cosine k-NN over unit-length sketch features, held in one sparse matrix for speed. Whole drawings
 * come first in the matrix, so a finished sketch is compared with them alone and a sketch still
 * under the pen with every row, half-finished ones included.
 */
export class QuickdrawRecognizer {
  readonly #matrix: FeatureMatrix;
  readonly #options: RecognizerOptions;

  constructor(
    source: FeatureMatrix | readonly LabelledFeature[],
    options: RecognizerOptions = DEFAULT_RECOGNIZER_OPTIONS,
  ) {
    this.#matrix = isFeatureMatrix(source) ? source : buildFeatureMatrix(source);
    this.#options = options;
  }

  /** How many sketches are known, however many prefixes each is indexed at. */
  get size(): number {
    return this.#matrix.completeRows;
  }

  get rows(): number {
    return rowCountOf(this.#matrix);
  }

  recognize(strokes: readonly Stroke[], options?: RankOptions): readonly string[] {
    return this.rank(strokes, options).map(({ category }) => category);
  }

  /** Best first, each with its share of the neighbours' vote (0–1): how sure, not just what. */
  rank(
    strokes: readonly Stroke[],
    { partial = false }: RankOptions = {},
  ): readonly RankedCategory[] {
    return statedGuesses(this.score(strokes, { partial }), partial, this.#options);
  }

  /** The stated guesses, and the vote share from which the leader may be taken without asking. */
  read(strokes: readonly Stroke[], options: RankOptions = {}): Reading {
    return {
      ranking: this.rank(strokes, options),
      certainAbove: floorFor(this.#options.certainAbove, options),
    };
  }

  /** Every category the neighbours voted for, best first, before deciding what is worth saying. */
  score(
    strokes: readonly Stroke[],
    { partial = false }: RankOptions = {},
  ): readonly RankedCategory[] {
    const nearest = this.#nearest(
      computeFeature(strokes),
      partial ? this.rows : this.#matrix.completeRows,
    );
    const best = nearest[0];
    if (best === undefined || best.similarity < this.#options.similarityFloor) return [];
    const { categories, rowCategories } = this.#matrix;
    const votes = new Map<string, number>();
    for (const { index, similarity } of nearest) {
      const category = categories[rowCategories[index] ?? 0] ?? "";
      const weight = Math.max(0, similarity) ** this.#options.voteSharpness;
      votes.set(category, (votes.get(category) ?? 0) + weight);
    }
    const total = [...votes.values()].reduce((sum, vote) => sum + vote, 0);
    return [...votes]
      .map(([category, vote]) => ({ category, confidence: vote / total }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  #nearest(feature: Float32Array, rows: number): readonly Neighbour[] {
    const { rowStarts, cells, values } = this.#matrix;
    const capacity = this.#options.neighbours;
    const nearest: Neighbour[] = [];
    let weakest = Number.NEGATIVE_INFINITY;
    for (let row = 0; row < rows; row += 1) {
      const end = rowStarts[row + 1] ?? 0;
      let similarity = 0;
      for (let entry = rowStarts[row] ?? 0; entry < end; entry += 1) {
        similarity += (values[entry] ?? 0) * (feature[cells[entry] ?? 0] ?? 0);
      }
      if (similarity <= weakest) continue;
      insertNeighbour(nearest, { index: row, similarity }, capacity);
      if (nearest.length >= capacity) weakest = nearest.at(-1)?.similarity ?? weakest;
    }
    return nearest;
  }
}

export const asAsyncRecognizer = (recognizer: QuickdrawRecognizer): AsyncSketchRecognizer => ({
  rank: async (strokes, options) => recognizer.rank(strokes, options),
});
