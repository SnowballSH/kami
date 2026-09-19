/** The shapes every sketch recogniser in the chain agrees on: the sidecar, the k-NN and the fallback. */
import type { Stroke } from "../../src/core/geometry";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RankedCategory {
  readonly category: string;
  readonly confidence: number;
}

export interface RankOptions {
  /** The drawing is still under the pen: compare it with half-finished sketches too, and speak only when sure. */
  readonly partial?: boolean | undefined;
}

export type Ranking = readonly RankedCategory[];

/** The leader confidence from which a drawing may be named without asking the player; null means never. */
export type CertaintyFloor = number | null;

/** A recogniser's confidence is worth more on a finished drawing than on one still under the pen. */
export interface CertaintyFloors {
  readonly finished: CertaintyFloor;
  readonly partial: CertaintyFloor;
}

/** What a recogniser makes of a sketch, and how far its own confidence may be trusted this time. */
export interface Reading {
  readonly ranking: Ranking;
  readonly certainAbove: CertaintyFloor;
}

export interface SketchRanker {
  read(strokes: readonly Stroke[], options?: RankOptions): Promise<Reading>;
}

export interface UnreliableSketchRanker {
  /** Null when it could not answer: unreachable, too slow, or talking nonsense. */
  read(strokes: readonly Stroke[], options?: RankOptions): Promise<Reading | null>;
}

export interface InProcessSketchRanker {
  read(strokes: readonly Stroke[], options?: RankOptions): Reading | Promise<Reading>;
}
