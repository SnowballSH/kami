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
import { PersistenceError, persistenceFailure } from "./persistenceError";
import { withRequestDeadline } from "./requestDeadline";
import { boardSnapshotSchema, boardSummaryListSchema } from "./schemas";
import type {
  BoardSnapshot,
  BoardStore,
  BoardSummary,
  PersistenceFailure,
  PersistenceState,
  StoredDrawing,
} from "./types";
import { WriteQueue } from "./writeQueue";

const EMPTY_SNAPSHOT: BoardSnapshot = { drawings: [], notes: [], rules: [] };

const UNREACHABLE_WARNING =
  "Kami's memory (the server behind /api) is unreachable; this board will not be remembered.";

interface Mutation {
  readonly key: string;
  readonly path: string;
  readonly init: RequestInit;
  readonly apply: (snapshot: BoardSnapshot) => BoardSnapshot;
  readonly order: number;
  running: Promise<void> | null;
  error: PersistenceFailure | null;
}

interface Memory {
  snapshot: BoardSnapshot | null;
  readonly pending: Map<string, Mutation>;
  loading: number;
  saving: number;
  loadError: PersistenceFailure | null;
}

const CLEAR = "";

export class HttpBoardStore implements BoardStore {
  readonly #fetch: FetchLike;
  readonly #queue = new WriteQueue();
  readonly #boards = new Map<string, Memory>();
  #listError: PersistenceFailure | null = null;
  #order = 0;
  #warned = false;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  readonly keepsBoards = true;

  get hasUnsavedChanges(): boolean {
    return [...this.#boards.values()].some((memory) => memory.pending.size > 0);
  }

  state(boardId: string): PersistenceState {
    const memory = this.#memory(boardId);
    const errors = [memory.loadError, this.#listError];
    for (const mutation of memory.pending.values()) errors.push(mutation.error);
    return {
      loading: memory.loading > 0,
      saving: memory.saving > 0,
      unsaved: memory.pending.size,
      errors: errors.filter((error) => error !== null),
    };
  }

  async retry(boardId: string): Promise<void> {
    const pending = [...this.#memory(boardId).pending.values()];
    await Promise.all(pending.map((mutation) => this.#schedule(boardId, mutation, true)));
  }

  async load(boardId: string): Promise<BoardSnapshot> {
    const memory = this.#memory(boardId);
    memory.loading++;
    try {
      return await this.#queue.enqueueBarrier(boardId, async () => {
        try {
          const path = boardPath(boardId);
          const body: BoardSnapshot = parseBoardResponse(
            boardSnapshotSchema,
            path,
            await this.#read(path, "load"),
          );
          memory.snapshot = [...memory.pending.values()].reduce(
            (snapshot, mutation) => mutation.apply(snapshot),
            body,
          );
          memory.loadError = null;
          return memory.snapshot;
        } catch (error) {
          memory.loadError = persistenceFailure("load", error);
          this.#warnOnce(error);
          if (memory.snapshot !== null) return memory.snapshot;
          throw error;
        }
      });
    } finally {
      memory.loading--;
    }
  }

  async listBoards(): Promise<readonly BoardSummary[]> {
    try {
      const path = boardsPath();
      const body = parseBoardResponse(boardSummaryListSchema, path, await this.#read(path, "list"));
      this.#listError = null;
      return body.boards;
    } catch (error) {
      this.#listError = persistenceFailure("list", error);
      this.#warnOnce(error);
      throw error;
    }
  }

  saveDrawing(boardId: string, stored: StoredDrawing): void {
    const copy = structuredClone(stored);
    this.#put(boardId, "drawings", copy.drawing.id, copy, (snapshot) => ({
      ...snapshot,
      drawings: [
        ...snapshot.drawings.filter(({ drawing }) => drawing.id !== copy.drawing.id),
        copy,
      ],
    }));
  }

  deleteDrawing(boardId: string, id: DrawingId): void {
    this.#delete(boardId, "drawings", id, (snapshot) => ({
      ...snapshot,
      drawings: snapshot.drawings.filter(({ drawing }) => drawing.id !== id),
    }));
  }

  saveNote(boardId: string, note: Note): void {
    const copy = structuredClone(note);
    this.#put(boardId, "notes", copy.id, copy, (snapshot) => ({
      ...snapshot,
      notes: [...snapshot.notes.filter(({ id }) => id !== copy.id), copy],
    }));
  }

  deleteNote(boardId: string, id: NoteId): void {
    this.#delete(boardId, "notes", id, (snapshot) => ({
      ...snapshot,
      notes: snapshot.notes.filter((note) => note.id !== id),
    }));
  }

  saveRule(boardId: string, rule: Rule): void {
    const copy = structuredClone(rule);
    this.#put(boardId, "rules", copy.id, copy, (snapshot) => ({
      ...snapshot,
      rules: [...snapshot.rules.filter(({ id }) => id !== copy.id), copy],
    }));
  }

  deleteRule(boardId: string, id: RuleId): void {
    this.#delete(boardId, "rules", id, (snapshot) => ({
      ...snapshot,
      rules: snapshot.rules.filter((rule) => rule.id !== id),
    }));
  }

  clear(boardId: string): void {
    this.#memory(boardId).pending.clear();
    this.#remember(boardId, CLEAR, boardPath(boardId), { method: "DELETE" }, () => EMPTY_SNAPSHOT);
  }

  whenIdle(): Promise<void> {
    return this.#queue.whenIdle();
  }

  #put(
    boardId: string,
    kind: EntityKind,
    id: string,
    entity: object,
    apply: Mutation["apply"],
  ): void {
    const body = JSON.stringify(entity);
    this.#remember(
      boardId,
      `${kind}/${id}`,
      entityPath(boardId, kind, id),
      { method: "PUT", headers: JSON_HEADERS, body },
      apply,
    );
  }

  #delete(boardId: string, kind: EntityKind, id: string, apply: Mutation["apply"]): void {
    this.#remember(
      boardId,
      `${kind}/${id}`,
      entityPath(boardId, kind, id),
      { method: "DELETE" },
      apply,
    );
  }

  #remember(
    boardId: string,
    key: string,
    path: string,
    init: RequestInit,
    apply: Mutation["apply"],
  ): void {
    const memory = this.#memory(boardId);
    const mutation: Mutation = {
      key,
      path,
      init,
      apply,
      order: this.#order++,
      running: null,
      error: null,
    };
    memory.snapshot = apply(memory.snapshot ?? EMPTY_SNAPSHOT);
    memory.pending.delete(key);
    memory.pending.set(key, mutation);
    void this.#schedule(boardId, mutation);
  }

  #schedule(boardId: string, mutation: Mutation, retry = false): Promise<void> {
    if (mutation.running !== null) return mutation.running;
    const memory = this.#memory(boardId);
    memory.saving++;
    const task = async (): Promise<void> => {
      try {
        if (retry && memory.pending.get(mutation.key) !== mutation) return;
        const clear = memory.pending.get(CLEAR);
        if (clear !== undefined && clear.order < mutation.order) return;
        await withRequestDeadline(async (signal) => {
          const response = await this.#fetch(mutation.path, { ...mutation.init, signal });
          this.#checkResponse(response, "save");
        });
        if (memory.pending.get(mutation.key) === mutation) memory.pending.delete(mutation.key);
      } catch (error) {
        mutation.error = persistenceFailure("save", error);
        this.#warnOnce(error);
      } finally {
        mutation.running = null;
        memory.saving--;
      }
    };
    mutation.running =
      mutation.key === CLEAR
        ? this.#queue.enqueueBarrier(boardId, task)
        : this.#queue.enqueue(boardId, mutation.key, task);
    return mutation.running;
  }

  #read(path: string, operation: "load" | "list"): Promise<unknown> {
    return withRequestDeadline(async (signal) => {
      const response = await this.#fetch(path, { signal });
      this.#checkResponse(response, operation);
      try {
        return await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) rejectBoardResponse(path, ["response: invalid JSON"]);
        throw error;
      }
    });
  }

  #checkResponse(response: Response, operation: PersistenceFailure["operation"]): void {
    if (!response.ok) {
      throw new PersistenceError({ operation, reason: "http", status: response.status });
    }
  }

  #memory(boardId: string): Memory {
    const existing = this.#boards.get(boardId);
    if (existing !== undefined) return existing;
    const memory: Memory = {
      snapshot: null,
      pending: new Map(),
      loading: 0,
      saving: 0,
      loadError: null,
    };
    this.#boards.set(boardId, memory);
    return memory;
  }

  #warnOnce(cause: unknown): void {
    if (this.#warned) return;
    this.#warned = true;
    console.warn(UNREACHABLE_WARNING, cause);
  }
}
