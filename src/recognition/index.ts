import { HttpRecognizer } from "./httpRecognizer";
import type { LiveRecognizer } from "./types";

export type * from "./types";

/** Asks the Kami server (`POST /api/recognize`); resolves to [] if it is unreachable. */
export function createRecognizer(): LiveRecognizer {
  return new HttpRecognizer();
}
