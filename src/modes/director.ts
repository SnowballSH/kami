import { EmbodiedDirector } from "./embodiedDirector";
import { PUZZLE_MODE_ID, PuzzleDirector } from "./puzzle";
import { SpiritDirector } from "./spiritDirector";
import type { GameMode, ModeDirector } from "./types";

/** The referee for a mode: the puzzle run's own, otherwise the one for how the mode opens — with a body, or as a spirit. */
export const createDirector = (mode: GameMode): ModeDirector => {
  if (mode.id === PUZZLE_MODE_ID) return new PuzzleDirector(mode);
  switch (mode.opening.player) {
    case "body":
      return new EmbodiedDirector(mode);
    case "spirit":
      return new SpiritDirector(mode, mode.opening.incarnation);
  }
};
