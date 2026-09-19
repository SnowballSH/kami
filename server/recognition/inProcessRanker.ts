/** Gives an in-process recogniser (the k-NN) the asynchronous shape the rest of the chain speaks. */
import type { InProcessSketchRanker, SketchRanker } from "./types";

export const asSketchRanker = (recognizer: InProcessSketchRanker): SketchRanker => ({
  read: async (strokes, options) => recognizer.read(strokes, options),
});
