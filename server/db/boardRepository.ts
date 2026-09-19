import type { Note } from "../../src/notes/types";
import type { BoardSnapshot, BoardSummary, StoredDrawing } from "../../src/persistence/types";
import type { Rule } from "../../src/rules/types";
import type { Collection, Db, Document, Sort } from "./mongo";

export const ENTITY_KINDS = ["drawings", "notes", "rules"] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const isEntityKind = (value: string): value is EntityKind =>
  (ENTITY_KINDS as readonly string[]).includes(value);

const HIDE_STORAGE_FIELDS = { _id: 0, boardId: 0 } as const;
const HIDE_STORAGE_FIELDS_AND_ID = { ...HIDE_STORAGE_FIELDS, id: 0 } as const;

const OLDEST_FIRST: Sort = { _id: 1 };
const BY_CREATION: Sort = { createdAt: 1, _id: 1 };

interface BoardCount {
  readonly _id: string;
  readonly count: number;
}

export class BoardRepository {
  readonly #collections: Readonly<Record<EntityKind, Collection<Document>>>;

  constructor(db: Db) {
    this.#collections = {
      drawings: db.collection("drawings"),
      notes: db.collection("notes"),
      rules: db.collection("rules"),
    };
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all(
      ENTITY_KINDS.map((kind) =>
        this.#collections[kind].createIndex({ boardId: 1, id: 1 }, { unique: true }),
      ),
    );
  }

  async snapshot(boardId: string): Promise<BoardSnapshot> {
    const [drawings, notes, rules] = await Promise.all([
      this.#collections.drawings
        .find<StoredDrawing>({ boardId }, { projection: HIDE_STORAGE_FIELDS_AND_ID })
        .sort(OLDEST_FIRST)
        .toArray(),
      this.#collections.notes
        .find<Note>({ boardId }, { projection: HIDE_STORAGE_FIELDS })
        .sort(BY_CREATION)
        .toArray(),
      this.#collections.rules
        .find<Rule>({ boardId }, { projection: HIDE_STORAGE_FIELDS })
        .sort(BY_CREATION)
        .toArray(),
    ]);
    return { drawings, notes, rules };
  }

  async summaries(): Promise<readonly BoardSummary[]> {
    const [drawings, notes, rules] = await Promise.all([
      this.#countPerBoard("drawings"),
      this.#countPerBoard("notes"),
      this.#countPerBoard("rules"),
    ]);
    const boardIds = new Set([drawings, notes, rules].flatMap((counts) => [...counts.keys()]));
    return [...boardIds].sort().map((id) => ({
      id,
      drawings: drawings.get(id) ?? 0,
      rules: rules.get(id) ?? 0,
    }));
  }

  async upsert(kind: EntityKind, boardId: string, id: string, entity: object): Promise<void> {
    await this.#collections[kind].replaceOne(
      { boardId, id },
      { ...entity, id, boardId },
      { upsert: true },
    );
  }

  async remove(kind: EntityKind, boardId: string, id: string): Promise<void> {
    await this.#collections[kind].deleteOne({ boardId, id });
  }

  async clear(boardId: string): Promise<void> {
    await Promise.all(ENTITY_KINDS.map((kind) => this.#collections[kind].deleteMany({ boardId })));
  }

  async #countPerBoard(kind: EntityKind): Promise<ReadonlyMap<string, number>> {
    const counts = await this.#collections[kind]
      .aggregate<BoardCount>([{ $group: { _id: "$boardId", count: { $sum: 1 } } }])
      .toArray();
    return new Map(counts.map(({ _id, count }) => [_id, count]));
  }
}
