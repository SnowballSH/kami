import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { Rule, RuleId } from "../rules/types";
import {
  boardPath,
  boardsPath,
  browserFetch,
  type EntityKind,
  entityPath,
  type FetchLike,
  JSON_HEADERS,
} from "./api";
import type { BoardSnapshot, BoardStore, BoardSummary, StoredDrawing } from "./types";
import { WriteQueue } from "./writeQueue";

const EMPTY_SNAPSHOT: BoardSnapshot = { drawings: [], notes: [], rules: [] };

const UNREACHABLE_WARNING =
  "Kami's memory (the server behind /api) is unreachable; this board will not be remembered.";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isSnapshot = (body: unknown): body is BoardSnapshot =>
  isRecord(body) &&
  Array.isArray(body.drawings) &&
  Array.isArray(body.notes) &&
  Array.isArray(body.rules);

const isSummaryList = (body: unknown): body is { readonly boards: readonly BoardSummary[] } =>
  isRecord(body) && Array.isArray(body.boards);

export class HttpBoardStore implements BoardStore {
  readonly #fetch: FetchLike;
  readonly #queue = new WriteQueue();
  #warned = false;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async load(boardId: string): Promise<BoardSnapshot> {
    const body = await this.#read(boardPath(boardId));
    return isSnapshot(body) ? body : EMPTY_SNAPSHOT;
  }

  async listBoards(): Promise<readonly BoardSummary[]> {
    const body = await this.#read(boardsPath());
    return isSummaryList(body) ? body.boards : [];
  }

  saveDrawing(boardId: string, stored: StoredDrawing): void {
    this.#put(boardId, "drawings", stored.drawing.id, stored);
  }

  deleteDrawing(boardId: string, id: DrawingId): void {
    this.#delete(boardId, "drawings", id);
  }

  saveNote(boardId: string, note: Note): void {
    this.#put(boardId, "notes", note.id, note);
  }

  deleteNote(boardId: string, id: NoteId): void {
    this.#delete(boardId, "notes", id);
  }

  saveRule(boardId: string, rule: Rule): void {
    this.#put(boardId, "rules", rule.id, rule);
  }

  deleteRule(boardId: string, id: RuleId): void {
    this.#delete(boardId, "rules", id);
  }

  clear(boardId: string): void {
    void this.#queue.enqueueBarrier(boardId, () =>
      this.#write(boardPath(boardId), { method: "DELETE" }),
    );
  }

  whenIdle(): Promise<void> {
    return this.#queue.whenIdle();
  }

  #put(boardId: string, kind: EntityKind, id: string, entity: object): void {
    const body = JSON.stringify(entity);
    void this.#queue.enqueue(boardId, `${kind}/${id}`, () =>
      this.#write(entityPath(boardId, kind, id), { method: "PUT", headers: JSON_HEADERS, body }),
    );
  }

  #delete(boardId: string, kind: EntityKind, id: string): void {
    void this.#queue.enqueue(boardId, `${kind}/${id}`, () =>
      this.#write(entityPath(boardId, kind, id), { method: "DELETE" }),
    );
  }

  async #read(path: string): Promise<unknown> {
    try {
      const response = await this.#fetch(path);
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return await response.json();
    } catch (error) {
      this.#warnOnce(error);
      return undefined;
    }
  }

  async #write(path: string, init: RequestInit): Promise<void> {
    try {
      const response = await this.#fetch(path, init);
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    } catch (error) {
      this.#warnOnce(error);
    }
  }

  #warnOnce(cause: unknown): void {
    if (this.#warned) return;
    this.#warned = true;
    console.warn(UNREACHABLE_WARNING, cause);
  }
}
