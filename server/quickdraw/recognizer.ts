import type { Stroke } from "../../src/core/geometry";
import { computeFeature, FEATURE_LENGTH } from "./feature";

export interface LabelledFeature {
  readonly category: string;
  readonly feature: Float32Array;
}

interface RankedCategory {
  readonly category: string;
  readonly confidence: number;
}

export interface RecognizerOptions {
  readonly neighbours: number;
  readonly voteSharpness: number;
  readonly confidenceFloor: number;
  readonly similarityFloor: number;
  readonly maxGuesses: number;
}

const DEFAULT_RECOGNIZER_OPTIONS: RecognizerOptions = {
  neighbours: 15,
  voteSharpness: 8,
  confidenceFloor: 0.08,
  similarityFloor: 0.35,
  maxGuesses: 3,
};

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

/** Cosine k-NN over unit-length sketch features, held in one flat matrix for speed. */
export class QuickdrawRecognizer {
  readonly #categories: readonly string[];
  readonly #matrix: Float32Array;
  readonly #options: RecognizerOptions;

  constructor(
    samples: readonly LabelledFeature[],
    options: RecognizerOptions = DEFAULT_RECOGNIZER_OPTIONS,
  ) {
    const usable = samples.filter(({ feature }) => feature.length === FEATURE_LENGTH);
    this.#categories = usable.map(({ category }) => category);
    this.#matrix = new Float32Array(usable.length * FEATURE_LENGTH);
    for (const [row, { feature }] of usable.entries()) {
      this.#matrix.set(feature, row * FEATURE_LENGTH);
    }
    this.#options = options;
  }

  get size(): number {
    return this.#categories.length;
  }

  recognize(strokes: readonly Stroke[]): readonly string[] {
    return this.#rank(computeFeature(strokes))
      .filter(({ confidence }) => confidence >= this.#options.confidenceFloor)
      .slice(0, this.#options.maxGuesses)
      .map(({ category }) => category);
  }

  #rank(feature: Float32Array): readonly RankedCategory[] {
    const nearest = this.#nearest(feature);
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

  #nearest(feature: Float32Array): readonly Neighbour[] {
    const nearest: Neighbour[] = [];
    for (let row = 0; row < this.#categories.length; row += 1) {
      const offset = row * FEATURE_LENGTH;
      let similarity = 0;
      for (let cell = 0; cell < FEATURE_LENGTH; cell += 1) {
        similarity += (this.#matrix[offset + cell] ?? 0) * (feature[cell] ?? 0);
      }
      insertNeighbour(nearest, { index: row, similarity }, this.#options.neighbours);
    }
    return nearest;
  }
}
