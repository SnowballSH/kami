import type { Drawing } from "../ink/types";

/** Identifies a sketch. Backed by Google's Quick, Draw! dataset on the server. */
export interface Recognizer {
  /** Best guess first, as bare Quick, Draw! words ("mushroom"). Empty when unsure or offline — never rejects. */
  recognize(drawing: Drawing): Promise<readonly string[]>;
}
