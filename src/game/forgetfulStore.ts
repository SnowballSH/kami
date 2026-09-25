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

const NOTHING_KEPT: PersistenceState = { loading: false, saving: false, unsaved: 0, errors: [] };
const BLANK: BoardSnapshot = { drawings: [], notes: [], rules: [] };

/**
 * A store for play that leaves no trace: a puzzle room opens blank every time and remembers no
 * solution, and a page played without a server is gone when the tab closes.
 */
export class ForgetfulBoardStore implements BoardStore {
  readonly keepsBoards = false;
  readonly hasUnsavedChanges = false;

  state(_boardId: string): PersistenceState {
    return NOTHING_KEPT;
  }

  retry(_boardId: string): Promise<void> {
    return Promise.resolve();
  }

  load(_boardId: string): Promise<BoardSnapshot> {
    return Promise.resolve(BLANK);
  }

  listBoards(): Promise<readonly BoardSummary[]> {
    return Promise.resolve([]);
  }

  saveDrawing(_boardId: string, _stored: StoredDrawing): void {}
  deleteDrawing(_boardId: string, _id: DrawingId): void {}
  saveNote(_boardId: string, _note: Note): void {}
  deleteNote(_boardId: string, _id: NoteId): void {}
  saveRule(_boardId: string, _rule: Rule): void {}
  deleteRule(_boardId: string, _id: RuleId): void {}
  clear(_boardId: string): void {}
}
