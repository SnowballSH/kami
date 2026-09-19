import type { Drawing } from "../ink/types";

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
  "walker",
  "hopper",
  "flier",
  "attractor",
  "lantern",
  "solid",
  "goal",
  "hazard",
  "spawn",
] as const;

/**
 * What a drawing is. The first ten are spirits (spec §4). Then three creatures, which move by
 * themselves: `walker` paces, `hopper` leaps, `flier` roams the air. Then two fields: an
 * `attractor` pulls everything toward it, a `lantern` lights its patch at night. The last four are roles, for
 * sketching a new game: `solid` is ground that stays put wherever it was drawn, `goal` wins the board,
 * `hazard` sends Alice back to her checkpoint, `spawn` moves that checkpoint.
 */
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

/**
 * The single face of all the AI in the game. Methods are async where a model
 * could sit behind them; the demo implementation is offline and instant.
 */
export interface Cat {
  /** Resets the hint ladder and the once-per-room offer of help. */
  enterRoom(room: RoomBrief): void;
  /** Maps whatever the player said about `drawing` onto a nature. Never rejects. */
  name(utterance: string, drawing: Drawing): Promise<Ruling>;
  /**
   * His three best guesses at an unnamed drawing, as short names ("a mushroom"). What the
   * recognizer saw comes first; a geometric hunch fills in when it saw nothing.
   */
  guess(drawing: Drawing): Promise<readonly [string, string, string]>;
  /** "And what is that supposed to be?" */
  askWhatItIs(): string;
  /** Climbs one rung per call, never skips, stays on the answer once reached. */
  hint(): Hint;
  /** "Ask, if you like." — a line the first time per room, null afterwards. */
  offerHelp(): string | null;
}
