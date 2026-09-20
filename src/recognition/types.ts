import type { Nature } from "../cat/types";
import type { Stroke } from "../core/geometry";
import type { Drawing } from "../ink/types";

/** Identifies a sketch. Backed by Google's Quick, Draw! dataset on the server. */
export interface Recognizer {
  /** Best guess first, as bare Quick, Draw! words ("mushroom"). Empty when unsure or offline — never rejects. */
  recognize(drawing: Drawing): Promise<readonly string[]>;
}

/** One thing a sketch might be, and what it would be in the game if it were. */
export interface Sighting {
  /** The bare Quick, Draw! word ("mushroom"). */
  readonly word: string;
  /** 0–1: how sure. */
  readonly confidence: number;
  /** The word as Kami would write it ("a mushroom"). */
  readonly name: string;
  readonly nature: Nature;
  readonly strength: number;
  /** Kami's remark about it, short enough to handwrite. */
  readonly line: string;
  /** Sure enough to name without offering the player a choice. At most the first sighting is. */
  readonly certain: boolean;
}

export interface SightOptions {
  /** The pen is still moving. The server then stays silent until it is sure. */
  readonly partial?: boolean;
}

/**
 * The player's own drawing, tidied, and what it was missing. It stays theirs: nothing is replaced.
 */
export interface Completion {
  /**
   * The player's strokes again — the same number of strokes, each with the same number of points,
   * in the same order — every point nudged a small, bounded distance toward a clean drawing of the
   * same thing. Tween point for point from the ink to these.
   */
  readonly tidied: readonly Stroke[];
  /** Parts a finished drawing of this would have and theirs does not, to be drawn in. Often none. */
  readonly added: readonly Stroke[];
  /** The Quick, Draw! word it was tidied as. */
  readonly word: string;
  /** 0–1: how sure Kami is of the word. */
  readonly confidence: number;
}

/** A recogniser that also says what each guess means, and can look at a drawing still under the pen. */
export interface LiveRecognizer extends Recognizer {
  /**
   * Best first, at most three. Empty when unsure or offline — never rejects. An empty answer to a
   * partial look means "nothing to say yet": keep whatever was said before.
   */
  sight(strokes: readonly Stroke[], options?: SightOptions): Promise<readonly Sighting[]>;
  /**
   * Kami tidies and finishes the drawing. `name` is what the player called it, when they have.
   * Null when he has nothing to offer or is offline — keep the player's ink. Never rejects.
   */
  complete(strokes: readonly Stroke[], name?: string): Promise<Completion | null>;
}
