import type { DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";

export type Made =
  | { readonly kind: "drawing"; readonly id: DrawingId; readonly cost: number }
  | { readonly kind: "note"; readonly id: NoteId };

export const HANDIWORK_DEPTH = 256;

/**
 * What this player made on the open page, newest last, so undo can take it back. Only the
 * player's own drawings and notes enter it: never a peer's, never Kami's.
 */
export class Handiwork {
  private made: Made[] = [];

  record(made: Made): void {
    this.made.push(made);
    if (this.made.length > HANDIWORK_DEPTH) this.made.shift();
  }

  /** The newest thing made that `stands` still; whatever was already gone is forgotten on the way. */
  takeLatest(stands: (made: Made) => boolean): Made | null {
    for (let made = this.made.pop(); made !== undefined; made = this.made.pop()) {
      if (stands(made)) return made;
    }
    return null;
  }

  costOf(id: DrawingId): number {
    const made = this.made.find((entry) => entry.kind === "drawing" && entry.id === id);
    return made?.kind === "drawing" ? made.cost : 0;
  }

  clear(): void {
    this.made = [];
  }
}
