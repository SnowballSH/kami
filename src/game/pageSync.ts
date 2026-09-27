import { canonicalOf } from "../core/canonical";
import { penStrokesSchema } from "../core/input";
import { same } from "../core/same";
import type { DrawingId } from "../ink/types";
import type { Note, NoteId } from "../notes/types";
import type { BoardSnapshot, FeedCursor, StoredDrawing } from "../persistence/types";
import type { Rule } from "../rules/types";
import type { BoardChange } from "../sync";
import type { GameContext } from "./context";
import type { Lawgiver } from "./kami/lawgiver";
import { NOTE_LINGER_MS } from "./kami/naming";
import type { Reopener } from "./kami/reactions";
import type { NoteKeeping } from "./noteKeeping";
import type { Presence } from "./presence";

const ALREADY_AWAKE_MS = 10_000;
/**
 * Another device's note leaves when its writer lets it go. One whose writer vanished first leaves
 * this screen after this long, without being deleted: it is not this device's to delete.
 */
const PEER_NOTE_LIFETIME_MS = 120_000;
/** A note on a shared page this old has outlived any writer's answer: whoever opens the page tidies it. */
const ORPHANED_NOTE_AGE_MS = 10 * 60_000;

/**
 * The page as it is kept: what a load puts back, and on a shared page what other devices change,
 * each landing the way a local change does.
 */
export class PageSync {
  private latestAt = 0;

  constructor(
    private readonly context: GameContext,
    private readonly keeping: NoteKeeping,
    private readonly laws: Lawgiver,
    private readonly presence: Presence,
    private readonly reopener: Reopener,
  ) {}

  /** A creation time later than anything on the page, so every device orders notes the same. */
  stamp(): number {
    this.latestAt = Math.max(Date.now(), this.latestAt + 1);
    return this.latestAt;
  }

  restore({ drawings, notes, rules }: BoardSnapshot): void {
    for (const stored of drawings) this.placeDrawing(stored);
    for (const note of notes) this.placeNote(note, "restored");
    this.laws.restore(rules);
    this.context.party.invalidate();
  }

  /** On a shared page, hears what other devices do to it from `since`, where its snapshot was read. */
  follow(boardId: string, since: FeedCursor | null): void {
    this.presence.follow(boardId, since, {
      changed: (change) => this.receive(change),
      resync: () => void this.catchUp(boardId),
    });
  }

  /**
   * The feed lost its place: the page as the server has it now is folded into the board without
   * opening it afresh, so Alice, the stroke under the pen and the undo history stay where they are.
   */
  private async catchUp(boardId: string): Promise<void> {
    const current = this.context.clock.pageGuard();
    let snapshot: BoardSnapshot | null = null;
    try {
      snapshot = await this.context.store.load(boardId);
    } catch {
      // The store exposes the failure; the page is followed from where the feed stands now.
    }
    if (!current()) return;
    if (snapshot !== null) this.reconcile(snapshot);
    this.follow(boardId, snapshot?.cursor ?? null);
  }

  /** Takes off the board what the page no longer holds, then places what it does. */
  private reconcile({ drawings, notes, rules }: BoardSnapshot): void {
    const drawingIds = new Set<DrawingId>(drawings.map(({ drawing }) => drawing.id));
    const noteIds = new Set(notes.map(({ id }) => id));
    const ruleIds = new Set(rules.map(({ id }) => id));
    for (const id of this.context.ledger.ids()) if (!drawingIds.has(id)) this.dropDrawing(id);
    for (const note of this.context.notes.all)
      if (this.keeping.isStored(note) && !noteIds.has(note.id)) this.dropNote(note.id);
    for (const rule of this.laws.all) if (!ruleIds.has(rule.id)) this.laws.drop(rule.id);
    for (const stored of drawings) this.placeDrawing(stored);
    for (const note of notes) this.placeNote(note, "received");
    for (const rule of rules) this.placeLaw(rule);
  }

  private receive(change: BoardChange): void {
    switch (change.type) {
      case "put":
        switch (change.kind) {
          case "drawings":
            this.placeDrawing(change.entity);
            return;
          case "notes":
            this.placeNote(change.entity, "received");
            return;
          case "rules":
            this.placeLaw(change.entity);
            return;
        }
        return;
      case "delete":
        switch (change.kind) {
          case "drawings":
            this.dropDrawing(change.id);
            return;
          case "notes":
            this.dropNote(change.id);
            return;
          case "rules":
            this.laws.drop(change.id);
            return;
        }
        return;
      case "clear":
        this.reopener.open(this.context.board.id, { blank: true });
        return;
    }
  }

  /** A stored drawing takes its place on the page; one already there is left alone or retraced. */
  private placeDrawing({ drawing, ruling, provenance = "drawn" }: StoredDrawing): void {
    const { ledger, modules, clock, party } = this.context;
    const { sim } = modules;
    const known = ledger.get(drawing.id);
    if (known !== null) {
      if (!same(canonicalOf(penStrokesSchema, known.drawing.strokes), drawing.strokes)) {
        ledger.retrace(drawing.id, drawing.strokes, clock.nowMs);
      }
      if (ruling !== null && !same(known.ruling, ruling)) {
        sim.applyRuling(drawing.id, ruling);
        ledger.awaken(drawing.id, ruling, clock.nowMs);
      }
      return;
    }
    sim.addDrawing(drawing, provenance);
    ledger.add(drawing, provenance);
    if (ruling !== null) {
      sim.applyRuling(drawing.id, ruling);
      ledger.awaken(drawing.id, ruling, clock.nowMs - ALREADY_AWAKE_MS);
    }
    party.invalidate();
  }

  /**
   * A saved note takes its place where it was written. A note from a previous session fades after
   * `NOTE_LINGER_MS`, and the page forgets it with it, unless another device may still be answering
   * it; a note arriving from another device stays until its writer lets it go.
   */
  private placeNote(note: Note, from: "restored" | "received"): void {
    const { notes, clock } = this.context;
    this.latestAt = Math.max(this.latestAt, note.createdAt);
    if (same(notes.get(note.id), note)) return;
    const restored = from === "restored";
    notes.restore(note, clock.nowMs, restored ? NOTE_LINGER_MS : PEER_NOTE_LIFETIME_MS);
    this.keeping.placed(
      note,
      restored && (!this.presence.live || Date.now() - note.createdAt > ORPHANED_NOTE_AGE_MS),
    );
  }

  private placeLaw(rule: Rule): void {
    this.latestAt = Math.max(this.latestAt, rule.createdAt);
    this.laws.place(rule);
  }

  private dropDrawing(id: DrawingId): void {
    const { ledger, modules, party, notes } = this.context;
    if (ledger.remove(id) === null) return;
    modules.sim.removeDrawing(id);
    party.invalidate();
    this.keeping.dropped(notes.removeAnchoredTo({ type: "drawing", id }));
  }

  private dropNote(id: NoteId): void {
    this.keeping.dropped(this.context.notes.remove(id));
  }
}
