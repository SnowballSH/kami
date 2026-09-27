import type { HandwritingReader } from "../persistence/types";
import { PrefixPenReader } from "./penReader";
import type { PenReader } from "./types";

export { couldBeWriting } from "./gate";
export type { PenReader } from "./types";

export function createPenReader(reader: HandwritingReader): PenReader {
  return new PrefixPenReader(reader);
}
