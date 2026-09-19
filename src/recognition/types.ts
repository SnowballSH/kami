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
}

export interface SightOptions {
  /** The pen is still moving. The server then stays silent until it is sure. */
  readonly partial?: boolean;
}

/** A clean drawing of what the player sketched, placed where they sketched it. */
export interface Completion {
  /** World space, fitted inside the bounds of the player's own ink. */
  readonly strokes: readonly Stroke[];
  /** The Quick, Draw! word it was drawn as. */
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
   * Kami finishes the drawing: a tidy sketch of the same thing, to be drawn over (or instead of) the
   * player's ink. `name` is what the player called it, when they have. Null when he has nothing
   * better to offer or is offline — keep the player's ink. Never rejects.
   */
  complete(strokes: readonly Stroke[], name?: string): Promise<Completion | null>;
}
