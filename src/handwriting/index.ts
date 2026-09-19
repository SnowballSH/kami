import { PenHandwriting } from "./penHandwriting";
import { loadEmsFelix } from "./strokeFont";
import type { Handwriting } from "./types";

export type * from "./types";

/** A single-stroke handwriting font, written out with human wobble and human timing. */
export function createHandwriting(): Handwriting {
  return new PenHandwriting(loadEmsFelix());
}
