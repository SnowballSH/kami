import type { DrawingId } from "./types";

const DRAWING_ID_PREFIX = "drawing";
const RADIX = 36;
const ENTROPY_SPACE = RADIX ** 6;

/**
 * Ids outlive the page: drawings are remembered per board, so a fresh session must never
 * re-mint one. Time, a counter and some entropy stand in for `crypto.randomUUID`, which the
 * browser withholds on the plain-HTTP origin the iPad loads.
 */
export class DrawingIdSequence {
  #minted = 0;

  next(): DrawingId {
    this.#minted += 1;
    const parts = [Date.now(), this.#minted, Math.floor(Math.random() * ENTROPY_SPACE)];
    return [DRAWING_ID_PREFIX, ...parts.map((part) => part.toString(RADIX))].join("-") as DrawingId;
  }
}
