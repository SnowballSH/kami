import type { GameMode, GameModeId } from "../types";
import { FIRST_PUZZLE_BOARD_ID } from "./rooms";

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
    tagline: "Three rooms. One idea each. Something under the page is hungry.",
    opening: "Ink is precious here. Draw only what you mean.",
    again: {
      title: "Lost",
      tagline: "The ink eater got her. Again, this room.",
    },
    won: {
      title: "Solved",
      tagline: "Three rooms, all of them yours. Draw on, or play again.",
    },
  },
  opening: { player: "body", freshPage: false },
  win: { kind: "reach-goal" },
  loss: { kind: "board-restarts" },
  laws: { kind: "only", dials: ["inkEater"] },
  natures: "all",
  autopilot: "allowed",
  page: "room",
  help: "offered",
  sharing: "alone",
  menu: { kind: "run", firstBoardId: FIRST_PUZZLE_BOARD_ID },
};
