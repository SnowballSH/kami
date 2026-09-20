import { createDirector as createOpeningDirector } from "./embodiedDirector";
import { PUZZLE_MODE_ID, PuzzleDirector } from "./puzzle";
import type { GameMode, ModeDirector } from "./types";

/** The referee for a mode: the puzzle director for the puzzle run, otherwise the one for how the mode opens — with a body, or as a spirit. */
export const createDirector = (mode: GameMode): ModeDirector =>
  mode.id === PUZZLE_MODE_ID ? new PuzzleDirector(mode) : createOpeningDirector(mode);
