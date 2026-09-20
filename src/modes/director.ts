import { createDirector as createEmbodiedDirector } from "./embodiedDirector";
import { PUZZLE_MODE_ID, PuzzleDirector } from "./puzzle";
import type { GameMode, ModeDirector } from "./types";

/** The referee for a mode: the puzzle director for the puzzle run, otherwise whichever the opening calls for — embodied or spirit. */
export const createDirector = (mode: GameMode): ModeDirector =>
  mode.id === PUZZLE_MODE_ID ? new PuzzleDirector(mode) : createEmbodiedDirector(mode);
