import { allowsLaw, refusalLine } from "../../modes";
import type { Note, NoteId } from "../../notes/types";
import type { CompiledRule, Governs, Rule, RuleId, WorldPhysics } from "../../rules/types";
import type { LawsPanel } from "../../ui/types";
import type { GameContext } from "../context";
import { markUnderstood, type NoteKeeping } from "../noteKeeping";
import { groupedByNote, RuleBook } from "../ruleBook";
import {
  glossOf,
  LAW_OUTSIDE_MODE_LINE,
  RULE_REPEALED_LINE,
  SUMIKUI_SEALED_LINE,
  SUMIKUI_SUMMONED_LINES,
} from "./lines";
import { REMARK_LIFETIME_MS, type Voice } from "./voice";

/** The standing laws of the board: enacted, refused under the mode's policy, repealed, and folded into the world. */
export class Lawgiver {
  private readonly book: RuleBook;
  private sumikuiLoose = false;

  constructor(
    private readonly context: GameContext,
    private readonly voice: Voice,
    private readonly keeping: NoteKeeping,
    private readonly panel: LawsPanel,
  ) {
    this.book = new RuleBook((rules) =>
      context.modules.resolvePhysics(
        rules.filter((rule) => this.allows(rule)),
        context.director.room?.world,
      ),
    );
  }

  get all(): readonly Rule[] {
    return this.book.all;
  }

  get physics(): WorldPhysics {
    return this.book.physics;
  }

  allows(rule: Rule): boolean {
    const { director } = this.context;
    return allowsLaw(director.room?.laws ?? director.mode.laws, rule.effect.governs);
  }

  ruleFrom(compiled: CompiledRule, note: Note): Rule {
    return {
      ...compiled,
      id: this.context.ids.next<RuleId>("rule"),
      sourceText: note.text,
      noteId: note.id,
      position: note.position,
      createdAt: note.createdAt,
    };
  }

  enactIfAllowed(rule: Rule): void {
    if (this.allows(rule)) this.enactAll([rule], rule.noteId, glossOf(rule.explanation));
    else this.refuse(rule.noteId, rule.effect.governs);
  }

  /** Laws that stand or fall together under one note, glossed as one. */
  enactAll(rules: readonly Rule[], noteId: NoteId, gloss: string): void {
    const { store, board, party, stuck, clock } = this.context;
    for (const rule of rules) {
      this.book.enact(rule);
      store.saveRule(board.id, rule);
    }
    this.show();
    this.fold({ silently: false });
    party.invalidate();
    markUnderstood(this.context, noteId);
    this.voice.gloss(noteId, gloss);
    stuck.progress(clock.nowMs);
  }

  refuse(noteId: NoteId, dial?: Governs): void {
    const { notes, director } = this.context;
    notes.restyle(noteId, "plain");
    const under = notes.below(noteId);
    if (under === null) return;
    const line =
      dial === undefined
        ? LAW_OUTSIDE_MODE_LINE
        : refusalLine(director.mode, dial, LAW_OUTSIDE_MODE_LINE);
    this.voice.write(line, under, {
      anchor: { type: "note", id: noteId },
      lifetimeMs: REMARK_LIFETIME_MS,
      drift: "down",
    });
  }

  /** The note that wrote them was erased: its laws go, and Kami says so. */
  repealNote(noteId: NoteId): void {
    const repealed = this.book.repealByNote(noteId);
    if (repealed.length === 0) return;
    const { store, board, party } = this.context;
    this.show();
    for (const rule of repealed) store.deleteRule(board.id, rule.id);
    const sealed = this.fold({ silently: false });
    party.invalidate();
    if (!sealed) this.voice.remark(RULE_REPEALED_LINE);
  }

  /** Saved laws, put back as the page had them. */
  restore(rules: readonly Rule[]): void {
    const placed = rules.filter((rule) => this.book.place(rule));
    this.show();
    for (const [noteId, ofNote] of groupedByNote(placed)) this.glossNote(noteId, ofNote);
    this.fold({ silently: true });
  }

  /** A law another device wrote takes its place in the chronology. */
  place(rule: Rule): void {
    if (!this.book.place(rule)) return;
    const { notes, party } = this.context;
    this.show();
    this.keeping.dropped(notes.removeAnchoredTo({ type: "note", id: rule.noteId }));
    this.glossNote(
      rule.noteId,
      this.book.all.filter((standing) => standing.noteId === rule.noteId),
    );
    this.fold({ silently: false });
    party.invalidate();
  }

  drop(id: RuleId): void {
    if (this.book.repeal(id) === null) return;
    this.show();
    this.fold({ silently: false });
    this.context.party.invalidate();
  }

  clear(): void {
    this.book.replaceAll([]);
    this.show();
    this.fold({ silently: true });
  }

  private glossNote(noteId: NoteId, ofNote: readonly Rule[]): void {
    if (ofNote.every((rule) => this.allows(rule)))
      this.voice.gloss(noteId, glossOf(ofNote.map((rule) => rule.explanation).join(", ")));
    else this.refuse(noteId);
  }

  /** One entry per note: a scene's several laws stand together, and are repealed together. */
  private show(): void {
    const standing = this.book.all.filter((rule) => this.allows(rule));
    this.panel.setLaws(
      [...groupedByNote(standing).values()].map((ofNote) => ({
        id: ofNote[0].id,
        text: ofNote[0].sourceText,
        gloss: ofNote.map((rule) => rule.explanation).join(", "),
      })),
    );
  }

  /** Folds the standing laws into the world; returns whether this fold sealed the Sumikui away. */
  private fold({ silently }: { readonly silently: boolean }): boolean {
    const { sim } = this.context.modules;
    const physics = this.book.physics;
    sim.setPhysics(physics);
    this.context.party.resync(sim.alices().length);
    const loose = physics.inkEater > 0;
    const summoned = loose && !this.sumikuiLoose;
    const sealed = !loose && this.sumikuiLoose;
    this.sumikuiLoose = loose;
    if (sealed) this.voice.hush();
    if (silently) return sealed;
    if (summoned) this.voice.recite(SUMIKUI_SUMMONED_LINES);
    if (sealed) this.voice.remark(SUMIKUI_SEALED_LINE);
    return sealed;
  }
}
