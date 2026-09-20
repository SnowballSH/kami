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
import { parseBoardResponse, rejectBoardResponse } from "./boardResponse";
import { withRequestDeadline } from "./requestDeadline";
import { boardSnapshotSchema, boardSummaryListSchema } from "./schemas";
import type { BoardSnapshot, BoardStore, BoardSummary, StoredDrawing } from "./types";
import { WriteQueue } from "./writeQueue";

const EMPTY_SNAPSHOT: BoardSnapshot = { drawings: [], notes: [], rules: [] };

const UNREACHABLE_WARNING =
  "Kami's memory (the server behind /api) is unreachable; this board will not be remembered.";

export class HttpBoardStore implements BoardStore {
  readonly #fetch: FetchLike;
  readonly #queue = new WriteQueue();
  #warned = false;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  load(boardId: string): Promise<BoardSnapshot> {
    return this.#queue.enqueueBarrier(boardId, async () => {
      const path = boardPath(boardId);
      const body = await this.#read(path);
      return body === undefined
        ? EMPTY_SNAPSHOT
        : parseBoardResponse(boardSnapshotSchema, path, body);
    });
  }

  async listBoards(): Promise<readonly BoardSummary[]> {
    const path = boardsPath();
    const body = await this.#read(path);
    return body === undefined ? [] : parseBoardResponse(boardSummaryListSchema, path, body).boards;
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
      return await withRequestDeadline(async (signal) => {
        const response = await this.#fetch(path, { signal });
        if (!response.ok) throw new Error(`${path} answered ${response.status}`);
        return await response.json();
      });
    } catch (error) {
      if (error instanceof SyntaxError) rejectBoardResponse(path, ["response: invalid JSON"]);
      this.#warnOnce(error);
      return undefined;
    }
  }

  async #write(path: string, init: RequestInit): Promise<void> {
    try {
      await withRequestDeadline(async (signal) => {
        const response = await this.#fetch(path, { ...init, signal });
        if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      });
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
