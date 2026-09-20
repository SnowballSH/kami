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

/**
 * Kami's memory. Writes are fire-and-forget: they never reject, and a board keeps working
 * (unremembered) when the server or MongoDB is away.
 */
export interface BoardStore {
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

/**
 * Clean drawings to summon by name, from the server's dataset. Strokes come in Quick, Draw!'s
 * 0–255 space, top-left origin; the game scales and places them. `null` when the server has no
 * drawing of the thing, or did not answer.
 */
export interface SketchLibrary {
  categories(): Promise<readonly string[]>;
  sketch(category: string): Promise<readonly Stroke[] | null>;
}
