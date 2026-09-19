import type { Drawing } from "../ink/types";
import type { WorldEdit, WorldFacts } from "../world/types";

export const NATURES = [
  "ink",
  "bouncy",
  "climbable",
  "floaty",
  "heavy",
  "light",
  "slippery",
  "sticky",
  "grow",
  "shrink",
] as const;

export type Nature = (typeof NATURES)[number];

export type AllowedNatures = readonly Nature[] | "all";

export const STRENGTH_RANGE = { min: 0.5, max: 2 } as const;

/** The Cat's verdict on what a drawing is. The player's word is law; the Cat only maps it. */
export interface Ruling {
  /** The name as the player gave it, tidied for display ("a bouncy mushroom"). */
  readonly name: string;
  readonly nature: Nature;
  /** Within STRENGTH_RANGE; 1 unless the player used adjectives. */
  readonly strength: number;
  readonly tags: readonly string[];
  /** What the Cat says. In character, fifteen words or fewer, never "error" or "invalid". */
  readonly line: string;
}

export type HintTier = 1 | 2 | 3;

export interface Hint {
  readonly tier: HintTier;
  readonly line: string;
}

/** Everything the Cat knows about a room. */
export interface RoomBrief {
  readonly id: string;
  readonly allowedNatures: AllowedNatures;
  /** Nudge, direction, answer. */
  readonly hints: readonly [string, string, string];
}

export type Guesses = readonly [string, string, string];

/** A PNG data URL of the drawing on plain paper, made only if a Cat asks for it. */
export type SketchSource = () => string;

/** What the Cat sees when ink settles: a picture to be named, or words meant for the world. */
export type Glance =
  | { readonly kind: "picture"; readonly guesses: Guesses }
  | { readonly kind: "words"; readonly text: string };

/** The Cat's answer to words aimed at the world: what to change, and what he says about it. */
export interface Decree {
  readonly edits: readonly WorldEdit[];
  readonly line: string;
}

/**
 * The single face of all the AI in the game. Methods are async where a model
 * could sit behind them; the scripted implementation is offline and instant.
 */
export interface Cat {
  /** Resets the hint ladder and the once-per-room offer of help. */
  enterRoom(room: RoomBrief): void;
  /** Maps whatever the player said about `drawing` onto a nature. Never rejects. */
  name(utterance: string, drawing: Drawing, facts: WorldFacts): Promise<Ruling>;
  /** Looks at freshly settled ink: three guesses if it is a picture, the text if it is writing. */
  look(drawing: Drawing, sketch: SketchSource, facts: WorldFacts): Promise<Glance>;
  /** Turns words about the world ("g = 1 m/s²", "make it windy") into edits. */
  command(text: string, facts: WorldFacts): Promise<Decree>;
  /** "And what is that supposed to be?" */
  askWhatItIs(): string;
  /** Climbs one rung per call, never skips, stays on the answer once reached. */
  hint(): Hint;
  /** "Ask, if you like." — a line the first time per room, null afterwards. */
  offerHelp(): string | null;
}
