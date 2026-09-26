import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type {
  BoardSnapshot,
  BoardStore,
  BoardSummary,
  PersistenceState,
  StoredDrawing,
} from "../persistence/types";
import type { Rule, RuleId } from "../rules/types";
import type { BoardLink } from "./boardLink";
import { type BoardEdit, deletionOf } from "./wire";

/**
 * A board store that tells the link about each write before making it, so the link knows the echo
 * of this device's own write when the server relays it back (`LocalEdits`).
 */
export class EditTrackingStore implements BoardStore {
  constructor(
    private readonly store: BoardStore,
    private readonly link: BoardLink,
  ) {}

  get keepsBoards(): boolean {
    return this.store.keepsBoards;
  }

  get hasUnsavedChanges(): boolean {
    return this.store.hasUnsavedChanges;
  }

  state(boardId: string): PersistenceState {
    return this.store.state(boardId);
  }

  retry(boardId: string): Promise<void> {
    return this.store.retry(boardId);
  }

  load(boardId: string): Promise<BoardSnapshot> {
    return this.store.load(boardId);
  }

  listBoards(): Promise<readonly BoardSummary[]> {
    return this.store.listBoards();
  }

  saveDrawing(boardId: string, stored: StoredDrawing): void {
    this.wrote(boardId, { type: "put", kind: "drawings", id: stored.drawing.id, entity: stored });
    this.store.saveDrawing(boardId, stored);
  }

  deleteDrawing(boardId: string, id: DrawingId): void {
    this.wrote(boardId, deletionOf("drawings", id));
    this.store.deleteDrawing(boardId, id);
  }

  saveNote(boardId: string, note: Note): void {
    this.wrote(boardId, { type: "put", kind: "notes", id: note.id, entity: note });
    this.store.saveNote(boardId, note);
  }

  deleteNote(boardId: string, id: NoteId): void {
    this.wrote(boardId, deletionOf("notes", id));
    this.store.deleteNote(boardId, id);
  }

  saveRule(boardId: string, rule: Rule): void {
    this.wrote(boardId, { type: "put", kind: "rules", id: rule.id, entity: rule });
    this.store.saveRule(boardId, rule);
  }

  deleteRule(boardId: string, id: RuleId): void {
    this.wrote(boardId, deletionOf("rules", id));
    this.store.deleteRule(boardId, id);
  }

  clear(boardId: string): void {
    this.wrote(boardId, { type: "clear" });
    this.store.clear(boardId);
  }

  private wrote(boardId: string, edit: BoardEdit): void {
    if (this.store.keepsBoards) this.link.wrote(boardId, edit);
  }
}
