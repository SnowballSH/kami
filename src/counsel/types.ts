import type { Rect, Vec } from "../core/geometry";

/** What lies ahead of Alice, read the way her feet read the page. */
export type Surroundings =
  /** Ground ends and picks up again: the air between the banks, at foot level. */
  | { readonly kind: "gap"; readonly span: Rect }
  /** A rise too tall to jump: its near face, from its top down to foot level, and which way it lies. */
  | { readonly kind: "wall"; readonly face: Rect; readonly toward: -1 | 1 }
  /** Ground ends and nothing is drawn beyond it within reach. */
  | { readonly kind: "drop"; readonly edge: Vec }
  /** Nothing in the way, or nothing at all. */
  | { readonly kind: "open"; readonly beside: Vec };

/** A picture Kami offers to draw: the word he asks the summoning path for, and where it goes. */
export interface Sketch {
  readonly word: string;
  readonly box: Rect;
  /** Pulled to fill the box (a bridge, a ladder) or drawn to size within it (a creature). */
  readonly fit: "stretch" | "keep";
}

export interface Counsel {
  readonly line: string;
  readonly sketch: Sketch | null;
}
