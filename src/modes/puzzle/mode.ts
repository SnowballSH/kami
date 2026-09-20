import type { GameMode, GameModeId } from "../types";

export const PUZZLE_MODE_ID = "puzzle" as GameModeId;

/**
 * A run of rooms, each wanting one idea drawn or written, with the ink eater loose from the first
 * frame. The mode's own law policy is the fallback for a board that is not one of its rooms; each
 * room stages its own dials, always leaving the ink eater among them so it can be sealed.
 */
export const PUZZLE_MODE: GameMode = {
  id: PUZZLE_MODE_ID,
  card: {
    title: "Puzzle",
    tagline: "Seven rooms. One idea each. Something under the page is hungry.",
    opening: "Ink is precious here. Draw only what you mean.",
  },
  opening: { player: "body" },
  win: { kind: "reach-goal" },
  loss: { kind: "respawn" },
  laws: { kind: "only", dials: ["inkEater"] },
  natures: "all",
  autopilot: "allowed",
};
