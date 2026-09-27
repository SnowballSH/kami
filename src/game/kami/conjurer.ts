import type { Scene } from "../../autopilot/types";
import { groundSolids } from "../../board";
import { type Stroke, strokesLength, type Vec } from "../../core/geometry";
import { counselFor, placeSketch, surroundingsOf } from "../../counsel";
import { judgePlacement } from "../../ink/placement";
import type { Drawing, DrawingId, InkProvenance } from "../../ink/types";
import type { Note } from "../../notes/types";
import type { Scene as Destination } from "../../rules/types";
import { placeProp, type Wish } from "../../summoning";
import type { GameContext } from "../context";
import { storedOf } from "../inkLedger";
import { markUnderstood } from "../noteKeeping";
import { CANNOT_DRAW_LINE } from "./lines";
import type { Naming } from "./naming";
import type { Tidier } from "./tidier";
import { HINT_LIFETIME_MS, type Voice } from "./voice";

/** Kami draws one thing after another, not all at once. */
const PROP_STAGGER_MS = 450;

/** Kami's own drawings: what was wished for, the props of a scene, and the sketch in an idea. */
export class Conjurer {
  private ideasGiven = 0;

  constructor(
    private readonly context: GameContext,
    private readonly voice: Voice,
    private readonly naming: Naming,
    private readonly tidier: Tidier,
  ) {}

  /**
   * A finished drawing of each thing wished for, standing over the words in a row, inked in stroke
   * by stroke, solid at once and named as it would be had the player drawn it. Things that would
   * land in a no-ink zone are left out.
   */
  async summon(wish: Wish, note: Note, stillHere: () => boolean): Promise<void> {
    const { modules, notes, party } = this.context;
    const { summoner, sim, cat } = modules;
    const writing = notes.boundsOf(note.id);
    const summoned =
      summoner === undefined || writing === null
        ? []
        : await summoner.conjure(wish, writing, sim.aliceBounds(party.selected));
    if (!stillHere()) return;
    const landed = summoned.filter(({ strokes }) => this.fits(strokes));
    if (landed.length === 0) {
      this.voice.remarkUnder(note.id, CANNOT_DRAW_LINE(wish.asked));
      return;
    }
    const drawings = landed.map(({ word, strokes }, index) => ({
      word,
      drawing: this.conjure(strokes, this.context.clock.nowMs + index * PROP_STAGGER_MS),
    }));
    const [only] = drawings;
    if (only !== undefined && drawings.length === 1) {
      const ruling = await cat.name(only.word, only.drawing);
      if (stillHere() && this.context.ledger.get(only.drawing.id) !== null)
        this.naming.name(only.drawing.id, ruling, note);
      return;
    }
    markUnderstood(this.context, note.id);
    for (const { word, drawing } of drawings) void this.naming.label(drawing, word);
  }

  /** The props of a place Kami took everyone to, drawn in one after another above the words. */
  async dress(scene: Destination, note: Note, stillHere: () => boolean): Promise<void> {
    const { modules, notes, party, clock } = this.context;
    const { summoner, sim } = modules;
    if (summoner === undefined) return;
    const pictures = await Promise.all(
      scene.props.map(async (prop) => ({ prop, exemplar: await summoner.exemplar(prop.word) })),
    );
    const writing = notes.boundsOf(note.id);
    if (!stillHere() || writing === null) return;
    const drawn = pictures.flatMap(({ prop, exemplar }) =>
      exemplar === null ? [] : [{ prop, exemplar }],
    );
    drawn.forEach(({ prop, exemplar }, index) => {
      const strokes = placeProp(exemplar.strokes, writing, prop, sim.aliceBounds(party.selected));
      const drawing = this.conjure(strokes, clock.nowMs + index * PROP_STAGGER_MS, "scenery");
      void this.naming.label(drawing, exemplar.word);
    });
  }

  /**
   * Asked for an idea, Kami reads what is around Alice — a gap, a wall, nothing — writes it, and
   * where a picture would help (a bridge, a ladder, a friend) sketches one of his own and names it.
   */
  async counsel(around: Scene, at?: Vec): Promise<void> {
    const advice = counselFor(surroundingsOf(around), this.ideasGiven++);
    this.voice.remark(advice.line, HINT_LIFETIME_MS, at);
    if (advice.sketch === null) return;
    const current = this.context.clock.pageGuard();
    const exemplar = (await this.context.modules.summoner?.exemplar(advice.sketch.word)) ?? null;
    if (!current() || exemplar === null || exemplar.strokes.length === 0) return;
    const strokes = placeSketch(exemplar.strokes, advice.sketch);
    if (!this.fits(strokes)) return;
    void this.naming.label(this.conjure(strokes, this.context.clock.nowMs), exemplar.word);
  }

  private fits(strokes: readonly Stroke[]): boolean {
    const { board } = this.context;
    return (
      judgePlacement(strokes, {
        noInkZones: board.noInkZones,
        solids: groundSolids(board),
        aliceBounds: null,
      }) === "ok"
    );
  }

  /** Ink of Kami's own: whole and solid at once, shown being drawn in from `fromMs`. */
  private conjure(
    strokes: readonly Stroke[],
    fromMs: number,
    provenance: InkProvenance = "drawn",
  ): Drawing {
    const { ids, modules, party, ledger, store, board } = this.context;
    const drawing: Drawing = {
      id: ids.next<DrawingId>("drawing"),
      strokes,
      cost: strokesLength(strokes),
    };
    modules.sim.addDrawing(drawing, provenance);
    party.invalidate();
    const record = ledger.conjure(drawing, fromMs, provenance);
    this.tidier.alreadyTidy(drawing.id);
    store.saveDrawing(board.id, storedOf(record));
    return drawing;
  }
}
