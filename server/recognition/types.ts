/** The shapes every sketch recogniser in the chain agrees on: the sidecar, the k-NN and the fallback. */
import type { Stroke } from "../../src/core/geometry";
import type { RankedCategory } from "../quickdraw/recognizer";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RankOptions {
  readonly partial?: boolean | undefined;
}

export type Ranking = readonly RankedCategory[];

export interface SketchRanker {
  rank(strokes: readonly Stroke[], options?: RankOptions): Promise<Ranking>;
}

export interface UnreliableSketchRanker {
  /** Null when it could not answer: unreachable, too slow, or talking nonsense. */
  rank(strokes: readonly Stroke[], options?: RankOptions): Promise<Ranking | null>;
}

export interface InProcessSketchRanker {
  rank(strokes: readonly Stroke[], options?: RankOptions): Ranking | Promise<Ranking>;
}
