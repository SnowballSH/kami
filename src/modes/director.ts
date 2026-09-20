import { createDirector as createEmbodiedDirector } from "./embodiedDirector";
import { PUZZLE_MODE_ID, PuzzleDirector } from "./puzzle";
import type { GameMode, ModeDirector } from "./types";

/** The referee for a mode: the puzzle director for the puzzle run, the embodied one for any mode that opens with a body, null for openings nobody has built. */
export const createDirector = (mode: GameMode): ModeDirector | null =>
  mode.id === PUZZLE_MODE_ID ? new PuzzleDirector(mode) : createEmbodiedDirector(mode);
