import { groundSolids } from "../../board";
import type { Vec } from "../../core/geometry";
import { INPUT_LIMITS, isInputPoint, TEXT_LIMIT_MESSAGE } from "../../core/inputLimits";
import { isIdeaRequest } from "../../counsel";
import { isUnderGround } from "../../ink/placement";
import type { Note, NoteId } from "../../notes/types";
import { destinationOf, placeCalled, referentOf, speaksOfReferent } from "../../rules";
import type { CompileContext, Scene as Destination } from "../../rules/types";
import type { GameContext } from "../context";
import type { Eraser } from "../eraser";
import type { InkRecord } from "../inkLedger";
import { nearestInk } from "../inkNearby";
import type { Conjurer } from "./conjurer";
import type { Lawgiver } from "./lawgiver";
import { LineCycles } from "./lineCycles";
import {
  isHelpRequest,
  NAME_IT_FIRST_LINE,
  NOWHERE_LINE,
  REJECTION_LINES,
  SHRUGS,
  sceneGlossOf,
} from "./lines";
import { NAMING_REACH, type Naming, NOTE_LINGER_MS } from "./naming";
import type { Voice } from "./voice";

export interface Writer {
  askForHint(at: Vec): Promise<void>;
  /** The player's words, on the page and saved. */
  playerWrites(text: string, position: Vec): Note;
}

/** What a pronoun in a note stands for: the named drawing it was written beside, if any. */
const contextBeside = (beside: InkRecord | null): CompileContext | undefined => {
  const ruling = beside?.ruling ?? null;
  const referent = ruling === null ? null : referentOf(ruling.name);
  return referent === null ? undefined : { referent };
};

/**
 * The one funnel for words, typed or handwritten: a request for help, a law of physics, a place to
 * go, a wish for things, a name for a drawing, or a remark. Whatever is instant is tried first; the
 * model is only asked about what nothing else understood. A bare name ("a rabbit") beside a drawing
 * names it; anywhere else it summons.
 */
export class Funnel {
  private readonly shrugs = new LineCycles();

  constructor(
    private readonly context: GameContext,
    private readonly voice: Voice,
    private readonly laws: Lawgiver,
    private readonly naming: Naming,
    private readonly conjurer: Conjurer,
    private readonly eraser: Eraser,
    private readonly writer: Writer,
  ) {}

  async interpret(text: string, position: Vec): Promise<void> {
    const { board, director, notes, clock } = this.context;
    if (text.length > INPUT_LIMITS.text) {
      this.voice.remark(TEXT_LIMIT_MESSAGE);
      return;
    }
    if (!isInputPoint(position)) {
      this.voice.remark(REJECTION_LINES["out-of-bounds"]);
      return;
    }
    if (isUnderGround(position, groundSolids(board))) return;
    if (isHelpRequest(text) || (director.mode.help === "on-request" && isIdeaRequest(text))) {
      await this.writer.askForHint(position);
      return;
    }
    const note = this.writer.playerWrites(text, position);
    const stillHere = this.witness(note.id);
    await this.answer(text, note, stillHere);
    if (stillHere()) notes.release(note.id, clock.nowMs, NOTE_LINGER_MS);
  }

  private async answer(text: string, note: Note, stillHere: () => boolean): Promise<void> {
    const { compiler, thinker, summoner, cat } = this.context.modules;
    const beside = this.drawingNear(note.id);
    const context = contextBeside(beside);
    const law = await compiler.compile(text, context);
    if (!stillHere()) return;
    if (law !== null) {
      this.laws.enactIfAllowed(this.laws.ruleFrom(law, note));
      return;
    }
    if (beside !== null && beside.ruling === null && speaksOfReferent(text)) {
      this.voice.remarkUnder(note.id, NAME_IT_FIRST_LINE);
      return;
    }

    const where = destinationOf(text);
    if (where !== null) {
      const scene = await this.sceneOf(text, where, note.id);
      if (!stillHere()) return;
      if (scene !== null) {
        await this.travel(scene, note, stillHere);
        return;
      }
    }

    const subject = this.naming.bodyNamed(text) ?? this.drawingNear(note.id);
    const nameless = subject !== null && subject.ruling === null;
    const wish = (await summoner?.wish(text)) ?? null;
    if (!stillHere()) return;
    if (wish !== null && (wish.explicit || subject === null)) {
      await this.conjurer.summon(wish, note, stillHere);
      return;
    }

    const ruling = subject === null ? null : await cat.name(text, subject.drawing);
    if (!stillHere()) return;
    if (subject !== null && ruling !== null && ruling.nature !== "ink") {
      this.naming.name(subject.drawing.id, ruling, note);
      return;
    }
    if (wish !== null && !nameless) {
      await this.conjurer.summon(wish, note, stillHere);
      return;
    }

    const thought = await this.voice.ponderUnder(note.id, () => thinker.compile(text, context));
    if (!stillHere()) return;
    if (thought !== null) this.laws.enactIfAllowed(this.laws.ruleFrom(thought, note));
    else if (subject !== null && ruling !== null)
      this.naming.name(subject.drawing.id, ruling, note);
    else if (where !== null) this.voice.remarkUnder(note.id, NOWHERE_LINE(where));
    else this.voice.remarkUnder(note.id, this.shrugs.next(SHRUGS));
  }

  /** A place the atlas knows is there at once; for anywhere else the model is asked, and Kami says so. */
  private async sceneOf(text: string, where: string, noteId: NoteId): Promise<Destination | null> {
    const { scenes } = this.context.modules;
    if (scenes === undefined) return null;
    if (placeCalled(where) !== null) return scenes.compile(text);
    return this.voice.ponderUnder(noteId, () => scenes.compile(text));
  }

  /**
   * "Teleport us to the moon": every law of the place is enacted at once, all bound to the one
   * note (erase it, or tap the scene in the laws panel, and everyone comes home), and Kami dresses
   * the place with props of his own. The last place visited is left behind; a place the mode
   * forbids is refused whole.
   */
  private async travel(scene: Destination, note: Note, stillHere: () => boolean): Promise<void> {
    const rules = scene.laws.map((law) => ({
      ...this.laws.ruleFrom(law, note),
      scene: scene.place,
    }));
    const forbidden = rules.find((rule) => !this.laws.allows(rule));
    if (forbidden !== undefined) {
      this.laws.refuse(note.id, forbidden.effect.governs);
      return;
    }
    for (const { noteId } of this.laws.all.filter((rule) => rule.scene !== undefined))
      this.eraser.eraseNote(noteId);
    this.laws.enactAll(
      rules,
      note.id,
      sceneGlossOf(
        scene.place,
        rules.map((rule) => rule.explanation),
      ),
    );
    this.voice.remark(scene.line);
    await this.conjurer.dress(scene, note, stillHere);
  }

  /** True while the board stays open and the note stays on it. */
  private witness(noteId: NoteId): () => boolean {
    const current = this.context.clock.pageGuard();
    return () => current() && this.context.notes.get(noteId) !== null;
  }

  private drawingNear(noteId: NoteId): InkRecord | null {
    const { notes, modules, ledger } = this.context;
    const written = notes.boundsOf(noteId);
    if (written === null) return null;
    const near = nearestInk(written, modules.sim.snapshot().drawings, ledger);
    return near !== null && near.gap <= NAMING_REACH ? near.record : null;
  }
}
