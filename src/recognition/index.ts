import { HttpRecognizer } from "./httpRecognizer";
import type { Recognizer } from "./types";

export type * from "./types";

/** Asks the Kami server (`POST /api/recognize`); resolves to [] if it is unreachable. */
export function createRecognizer(): Recognizer {
  return new HttpRecognizer();
}
