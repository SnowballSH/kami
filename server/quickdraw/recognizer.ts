import type { Stroke } from "../../src/core/geometry";
import { floorFor } from "../recognition/certainty";
import type { CertaintyFloors, RankedCategory, RankOptions, Reading } from "../recognition/types";
import { computeFeature, FEATURE_LENGTH } from "./feature";
import { COMPLETE_FRACTION } from "./prefix";

export type { RankedCategory, RankOptions };

export interface LabelledFeature {
  readonly category: string;
  readonly feature: Float32Array;
  /** The share of the drawing's points this row was computed from; absent means all of them. */
  readonly fraction?: number;
}

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

const isComplete = ({ fraction = COMPLETE_FRACTION }: LabelledFeature): boolean =>
  fraction >= COMPLETE_FRACTION;

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
 * Cosine k-NN over unit-length sketch features, held in one flat matrix for speed. Whole drawings
 * come first in the matrix, so a finished sketch is compared with them alone and a sketch still
 * under the pen with every row, half-finished ones included.
 */
export class QuickdrawRecognizer {
  readonly #categories: readonly string[];
  readonly #matrix: Float32Array;
  readonly #completeRows: number;
  readonly #options: RecognizerOptions;

  constructor(
    samples: readonly LabelledFeature[],
    options: RecognizerOptions = DEFAULT_RECOGNIZER_OPTIONS,
  ) {
    const usable = samples.filter(({ feature }) => feature.length === FEATURE_LENGTH);
    const complete = usable.filter(isComplete);
    const ordered = [...complete, ...usable.filter((sample) => !isComplete(sample))];
    this.#categories = ordered.map(({ category }) => category);
    this.#matrix = new Float32Array(ordered.length * FEATURE_LENGTH);
    for (const [row, { feature }] of ordered.entries()) {
      this.#matrix.set(feature, row * FEATURE_LENGTH);
    }
    this.#completeRows = complete.length;
    this.#options = options;
  }

  /** How many sketches are known, however many prefixes each is indexed at. */
  get size(): number {
    return this.#completeRows;
  }

  get rows(): number {
    return this.#categories.length;
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
      partial ? this.rows : this.#completeRows,
    );
    const best = nearest[0];
    if (best === undefined || best.similarity < this.#options.similarityFloor) return [];
    const votes = new Map<string, number>();
    for (const { index, similarity } of nearest) {
      const category = this.#categories[index] ?? "";
      const weight = Math.max(0, similarity) ** this.#options.voteSharpness;
      votes.set(category, (votes.get(category) ?? 0) + weight);
    }
    const total = [...votes.values()].reduce((sum, vote) => sum + vote, 0);
    return [...votes]
      .map(([category, vote]) => ({ category, confidence: vote / total }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  #nearest(feature: Float32Array, rows: number): readonly Neighbour[] {
    const matrix = this.#matrix;
    const capacity = this.#options.neighbours;
    const nearest: Neighbour[] = [];
    let weakest = Number.NEGATIVE_INFINITY;
    for (let row = 0; row < rows; row += 1) {
      const offset = row * FEATURE_LENGTH;
      let similarity = 0;
      for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
        similarity += (matrix[offset + cell] ?? 0) * (feature[cell] ?? 0);
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
