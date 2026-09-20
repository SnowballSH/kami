import type { BoardDefinition } from "../../board/types";
import { boundsOf, type Stroke, type Vec } from "../../core/geometry";
import type { Handwriting, PenScript, WriteOptions } from "../../handwriting/types";
import type { DrawingId } from "../../ink/types";
import type { Note, NoteId } from "../../notes/types";
import type {
  BoardSnapshot,
  BoardStore,
  BoardSummary,
  PersistenceState,
  StoredDrawing,
} from "../../persistence/types";
import type { Camera, Renderer, RenderFrame } from "../../render/types";
import type { Rule, RuleId } from "../../rules/types";
import type {
  BoardListing,
  Hud,
  HudHandlers,
  LawListing,
  LawsPanel,
  LawsPanelHandlers,
  Tool,
} from "../../ui/types";
import type { EarsHandlers, Voice } from "../../voice/types";

export class FakeVoice implements Voice {
  readonly said: string[] = [];
  listening = false;
  waking = false;

  constructor(readonly handlers: EarsHandlers) {}

  wake(enabled: boolean): void {
    this.waking = enabled;
    this.handlers.onWakingChanged(enabled);
  }

  /** The player said his name and then something, with the microphone standing by. */
  woke(text: string): void {
    this.handlers.onHeard(text);
  }

  hold(): void {
    this.listening = true;
    this.handlers.onListeningChanged(true);
  }

  release(): void {
    this.listening = false;
    this.handlers.onListeningChanged(false);
  }

  cancel(): void {
    this.release();
    this.wake(false);
  }

  /** The player spoke, and Deepgram made out `text`. */
  heard(text: string): void {
    this.release();
    this.handlers.onHeard(text);
  }

  say(text: string): void {
    this.said.push(text);
  }

  hush(): void {
    this.said.length = 0;
  }
}

export class FakeHud implements Hud {
  tool: Tool = "draw";
  boards: readonly BoardListing[] = [];
  persistence: PersistenceState | null = null;
  private readonly answers: (string | null)[] = [];

  constructor(readonly handlers: HudHandlers) {}

  willWrite(text: string | null): void {
    this.answers.push(text);
  }

  autopilot: boolean | null = null;
  listening = false;
  waking = false;
  toolbarBottomY = 64;

  toolbarBottom(): number {
    return this.toolbarBottomY;
  }

  setAutopilot(enabled: boolean): void {
    this.autopilot = enabled;
  }

  tidiness: number | null = null;

  setTidiness(tidiness: number): void {
    this.tidiness = tidiness;
  }

  setListening(listening: boolean): void {
    this.listening = listening;
  }

  setWaking(waking: boolean): void {
    this.waking = waking;
  }

  setTool(tool: Tool): void {
    this.tool = tool;
  }

  setBoards(boards: readonly BoardListing[]): void {
    this.boards = boards;
  }

  setPersistence(state: PersistenceState): void {
    this.persistence = state;
  }

  promptText(): Promise<string | null> {
    return Promise.resolve(this.answers.shift() ?? null);
  }
}

export class FakeLawsPanel implements LawsPanel {
  laws: readonly LawListing[] = [];

  constructor(readonly handlers: LawsPanelHandlers) {}

  setLaws(laws: readonly LawListing[]): void {
    this.laws = laws;
  }
}

/** Client space is world space: the camera is ignored, so tests can speak in world px. */
export class FakeRenderer implements Renderer {
  board: BoardDefinition | null = null;
  lastFrame: RenderFrame | null = null;

  setBoard(board: BoardDefinition): void {
    this.board = board;
  }

  resize(): void {}

  toWorld(client: Vec, _camera: Camera): Vec {
    return client;
  }

  viewport(): { readonly width: number; readonly height: number } {
    return { width: 1180, height: 820 };
  }

  render(frame: RenderFrame): void {
    this.lastFrame = frame;
  }
}

const GLYPH_WIDTH = 0.5;
const INSTANT_MS = 1;

/** Writes every note as one underline-shaped stroke, instantly. */
export class FakeHandwriting implements Handwriting {
  write(text: string, { origin, size }: WriteOptions): PenScript {
    const stroke: Stroke = [
      { x: origin.x, y: origin.y },
      { x: origin.x + Math.max(1, text.length) * size * GLYPH_WIDTH, y: origin.y + size },
    ];
    return {
      text,
      strokes: [stroke],
      startsAtMs: [0],
      endsAtMs: [INSTANT_MS],
      durationMs: INSTANT_MS,
      bounds: boundsOf(stroke),
    };
  }

  reveal(script: PenScript, elapsedMs: number): readonly Stroke[] {
    return elapsedMs >= script.durationMs ? script.strokes : [];
  }
}

interface Shelf {
  readonly drawings: Map<DrawingId, StoredDrawing>;
  readonly notes: Map<NoteId, Note>;
  readonly rules: Map<RuleId, Rule>;
}

export class MemoryBoardStore implements BoardStore {
  private readonly shelves = new Map<string, Shelf>();
  readonly hasUnsavedChanges = false;

  state(): PersistenceState {
    return { loading: false, saving: false, unsaved: 0, errors: [] };
  }

  retry(): Promise<void> {
    return Promise.resolve();
  }

  load(boardId: string): Promise<BoardSnapshot> {
    const shelf = this.shelf(boardId);
    return Promise.resolve({
      drawings: [...shelf.drawings.values()],
      notes: [...shelf.notes.values()],
      rules: [...shelf.rules.values()],
    });
  }

  listBoards(): Promise<readonly BoardSummary[]> {
    return Promise.resolve(
      [...this.shelves].map(([id, shelf]) => ({
        id,
        drawings: shelf.drawings.size,
        rules: shelf.rules.size,
      })),
    );
  }

  saveDrawing(boardId: string, stored: StoredDrawing): void {
    this.shelf(boardId).drawings.set(stored.drawing.id, stored);
  }

  deleteDrawing(boardId: string, id: DrawingId): void {
    this.shelf(boardId).drawings.delete(id);
  }

  saveNote(boardId: string, note: Note): void {
    this.shelf(boardId).notes.set(note.id, note);
  }

  deleteNote(boardId: string, id: NoteId): void {
    this.shelf(boardId).notes.delete(id);
  }

  saveRule(boardId: string, rule: Rule): void {
    this.shelf(boardId).rules.set(rule.id, rule);
  }

  deleteRule(boardId: string, id: RuleId): void {
    this.shelf(boardId).rules.delete(id);
  }

  clear(boardId: string): void {
    this.shelves.delete(boardId);
  }

  private shelf(boardId: string): Shelf {
    const existing = this.shelves.get(boardId);
    if (existing !== undefined) return existing;
    const shelf: Shelf = { drawings: new Map(), notes: new Map(), rules: new Map() };
    this.shelves.set(boardId, shelf);
    return shelf;
  }
}
