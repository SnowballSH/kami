import type { Note, NoteId } from "../notes/types";
import type { GameContext } from "./context";

export const isPlayers = (note: Note): boolean => note.author === "player";

/** Kami understood the note: it turns green, and is saved so. */
export const markUnderstood = (
  { notes, store, board }: Pick<GameContext, "notes" | "store" | "board">,
  noteId: NoteId,
): void => {
  const note = notes.restyle(noteId, "understood");
  if (note !== null) store.saveNote(board.id, note);
};

/**
 * Which notes the page keeps — the player's words and the labels Kami hangs on drawings — and which
 * of them this device answers for. A note this device answers for is deleted from the page when it
 * fades; any other note only leaves this screen.
 */
export class NoteKeeping {
  private readonly labels = new Set<NoteId>();
  private readonly answered = new Set<NoteId>();

  constructor(private readonly deleteNote: (id: NoteId) => void) {}

  answerFor(id: NoteId): void {
    this.answered.add(id);
  }

  keepLabel(id: NoteId): void {
    this.labels.add(id);
    this.answered.add(id);
  }

  /** A saved note put back on the page: Kami's saved notes are all labels. */
  placed(note: Note, answeredHere: boolean): void {
    if (answeredHere) this.answered.add(note.id);
    if (!isPlayers(note)) this.labels.add(note.id);
  }

  isStored(note: Note): boolean {
    return isPlayers(note) || this.labels.has(note.id);
  }

  /** Notes taken off the page on purpose: an erase, a repeal, a name that replaced a guess. */
  forget(removed: readonly Note[]): void {
    for (const note of removed) {
      this.answered.delete(note.id);
      if (this.isStored(note)) this.deleteNote(note.id);
      this.labels.delete(note.id);
    }
  }

  /** Notes that left this screen without being deleted: another device took them away. */
  dropped(removed: readonly Note[]): void {
    for (const note of removed) this.labels.delete(note.id);
  }

  /** Notes whose time is up. */
  letGo(faded: readonly Note[]): void {
    this.forget(faded.filter((note) => this.answered.has(note.id)));
    this.dropped(faded);
  }

  clear(): void {
    this.labels.clear();
    this.answered.clear();
  }
}
