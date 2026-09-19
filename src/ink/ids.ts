import type { DrawingId } from "./types";

const DRAWING_ID_PREFIX = "drawing-";

export class DrawingIdSequence {
  #minted = 0;

  next(): DrawingId {
    this.#minted += 1;
    return `${DRAWING_ID_PREFIX}${this.#minted}` as DrawingId;
  }
}

export const pageDrawingIds = new DrawingIdSequence();
