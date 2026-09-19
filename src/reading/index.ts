import type { HandwritingReader } from "../persistence/types";
import { PrefixPenReader } from "./penReader";
import type { PenReader } from "./types";

export { couldBeWriting } from "./gate";
export type { PenReader } from "./types";

/** Reads pen strokes as words while the player writes them, through the given reader. */
export function createPenReader(reader: HandwritingReader): PenReader {
  return new PrefixPenReader(reader);
}
