import type { Ruling } from "../cat/types";
import type { Stroke } from "../core/geometry";
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

export interface PersistenceFailure {
  readonly operation: "load" | "save" | "list";
  readonly reason: "network" | "timeout" | "http" | "invalid-response";
  readonly status?: number;
}

export interface PersistenceState {
  readonly loading: boolean;
  readonly saving: boolean;
  readonly unsaved: number;
  readonly errors: readonly PersistenceFailure[];
}

/** Failed writes stay in memory until acknowledged or superseded. Reads may reject. */
export interface BoardStore {
  /** False for a store that forgets everything it is given: nothing on the page is saved. */
  readonly keepsBoards: boolean;
  readonly hasUnsavedChanges: boolean;
  state(boardId: string): PersistenceState;
  retry(boardId: string): Promise<void>;
  /** Malformed saved data rejects instead of being presented as an empty board. */
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

export interface ReadOptions {
  /** The strokes were drawn over or the board changed: the answer is no longer wanted. */
  readonly signal?: AbortSignal;
}

/**
 * Reads the player's handwriting from pen strokes, on the server. `null` means the strokes are a
 * drawing rather than writing — or the server has no reader, or did not answer in time.
 */
export interface HandwritingReader {
  read(strokes: readonly Stroke[], options?: ReadOptions): Promise<string | null>;
}

/** The Quick, Draw! words the server has pictures of; empty when it did not answer. */
export interface SketchCatalogue {
  categories(): Promise<readonly string[]>;
}
