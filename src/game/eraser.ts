import type { DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import type { GameContext } from "./context";
import type { Lawgiver } from "./lawgiver";
import type { NoteKeeping } from "./noteKeeping";

/** Takes things off the page for good, on this device and in the store: erased, eaten, used up. */
export class Eraser {
  constructor(
    private readonly context: GameContext,
    private readonly keeping: NoteKeeping,
    private readonly laws: Lawgiver,
  ) {}

  discard(id: DrawingId): void {
    const { ledger, modules, party, store, board, notes } = this.context;
    if (ledger.remove(id) === null) return;
    modules.sim.removeDrawing(id);
    party.invalidate();
    store.deleteDrawing(board.id, id);
    this.keeping.forget(notes.removeAnchoredTo({ type: "drawing", id }));
  }

  /** The note, what hangs off it, and every law it wrote. */
  eraseNote(id: NoteId): void {
    this.keeping.forget(this.context.notes.remove(id));
    this.laws.repealNote(id);
  }
}
