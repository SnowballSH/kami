import type { Ruling } from "../cat/types";
import type { Drawing, DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { Rule, RuleId } from "../rules/types";

export interface StoredDrawing {
  readonly drawing: Drawing;
  readonly ruling: Ruling | null;
}

export interface BoardSnapshot {
  readonly drawings: readonly StoredDrawing[];
  readonly notes: readonly Note[];
  readonly rules: readonly Rule[];
}

export interface BoardSummary {
  readonly id: string;
  readonly drawings: number;
  readonly rules: number;
}

/**
 * Kami's memory. Writes are fire-and-forget: they never reject, and a board keeps working
 * (unremembered) when the server or MongoDB is away.
 */
export interface BoardStore {
  load(boardId: string): Promise<BoardSnapshot>;
  listBoards(): Promise<readonly BoardSummary[]>;
  saveDrawing(boardId: string, stored: StoredDrawing): void;
  deleteDrawing(boardId: string, id: DrawingId): void;
  saveNote(boardId: string, note: Note): void;
  deleteNote(boardId: string, id: NoteId): void;
  saveRule(boardId: string, rule: Rule): void;
  deleteRule(boardId: string, id: RuleId): void;
  clear(boardId: string): void;
}
