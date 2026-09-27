import type { Ruling } from "../cat/types";
import { boundsOf, type Stroke, type Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import { namesABody } from "../modes";
import type { EmbodimentTransition } from "../modes/types";
import type { Note } from "../notes/types";
import { IS_THIS_HER_LINE } from "./bossLines";
import type { GameContext } from "./context";
import { type InkRecord, storedOf } from "./inkLedger";
import { type NearInk, nearestInk } from "./inkNearby";
import type { NoteAnchor } from "./noteBook";
import { markUnderstood, type NoteKeeping } from "./noteKeeping";
import type { Tidier } from "./tidier";
import { REMARK_LIFETIME_MS, type Voice } from "./voice";

/** How long the player's words, and the labels Kami hangs on drawings, stay once answered. */
export const NOTE_LINGER_MS = 12_000;
/** How far from a drawing words may be written and still be about it. */
export const NAMING_REACH = 190;
const GUESS_LIFETIME_MS = 12_000;
const GUESS_OFFSET = { x: 30, y: -4, line: 42 } as const;

/** Where Kami pencils his guesses about ink: just off its top right. */
export const guessCornerOf = (strokes: readonly Stroke[]): Vec => {
  const bounds = boundsOf(strokes.flat());
  return { x: bounds.x + bounds.width + GUESS_OFFSET.x, y: bounds.y + GUESS_OFFSET.y };
};

const capitalised = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** Kami's guesses about fresh ink, and the naming that wakes a drawing into what it is called. */
export class Naming {
  private askedWhatItIs = false;

  constructor(
    private readonly context: GameContext,
    private readonly voice: Voice,
    private readonly keeping: NoteKeeping,
    private readonly tidier: Tidier,
    private readonly embody: (transition: EmbodimentTransition) => void,
  ) {}

  reset(): void {
    this.askedWhatItIs = false;
  }

  /**
   * Kami looks at a drawing that has landed: one he is sure of is named at once; otherwise he
   * pencils in his guesses for the player to tap, and asks the first time what it is. Ink drawn
   * beside a waiting soul is asked about as her body.
   */
  async offerGuesses(drawing: Drawing): Promise<void> {
    const { cat } = this.context.modules;
    const current = this.context.clock.pageGuard();
    const { certain, rulings } = await cat.look(drawing);
    if (!current() || this.context.ledger.get(drawing.id)?.ruling !== null) return;

    const corner = guessCornerOf(drawing.strokes);
    const anchor: NoteAnchor = { type: "drawing", id: drawing.id };
    const question = (text: string): void => {
      this.askedWhatItIs = true;
      this.voice.write(
        text,
        { x: corner.x, y: corner.y - GUESS_OFFSET.line },
        { lifetimeMs: GUESS_LIFETIME_MS, anchor, drift: "down" },
      );
    };
    const guess = (shown: string, name: string, index: number, ruling?: Ruling): void => {
      this.voice.write(
        `${shown}?`,
        { x: corner.x, y: corner.y + index * GUESS_OFFSET.line },
        {
          lifetimeMs: GUESS_LIFETIME_MS,
          anchor,
          action: {
            type: "name-drawing",
            drawingId: drawing.id,
            name,
            ...(ruling === undefined ? {} : { ruling }),
          },
          drift: "down",
        },
      );
    };

    const [bodyName] = this.context.director.bodyNames;
    const nearSoul = this.nearestSoul();
    if (
      bodyName !== undefined &&
      nearSoul?.record.drawing.id === drawing.id &&
      nearSoul.gap <= NAMING_REACH
    ) {
      question(IS_THIS_HER_LINE);
      guess(capitalised(bodyName), bodyName, 0);
      return;
    }
    if (certain !== null) {
      this.name(drawing.id, cat.accept(certain), this.hangLabel(certain.name, corner));
      return;
    }
    if (!this.askedWhatItIs) question(cat.askWhatItIs());
    rulings.forEach((ruling, index) => {
      guess(ruling.name, ruling.name, index, ruling);
    });
  }

  /** The unnamed drawing nearest a waiting soul, when the words name one of the bodies she may take. */
  bodyNamed(text: string): InkRecord | null {
    const { bodyNames } = this.context.director;
    if (bodyNames.length === 0 || !namesABody(text, bodyNames)) return null;
    return this.nearestSoul()?.record ?? null;
  }

  async nameAs(id: DrawingId, name: string, label: Note): Promise<void> {
    const record = this.context.ledger.get(id);
    if (record === null) return;
    const current = this.context.clock.pageGuard();
    const ruling = await this.context.modules.cat.name(name, record.drawing);
    if (current()) this.name(id, ruling, label);
  }

  /** The drawing wakes as what it was named; `label` becomes the name it wears. */
  name(
    id: DrawingId,
    ruling: Ruling,
    label: Note,
    { quietly = false }: { readonly quietly?: boolean } = {},
  ): void {
    const { ledger, modules, party, store, board, notes, clock, stuck, director } = this.context;
    const awake = ledger.awaken(id, ruling, clock.nowMs);
    if (awake === null) return;

    modules.sim.applyRuling(id, ruling);
    party.invalidate();
    store.saveDrawing(board.id, storedOf(awake));
    this.keeping.forget(notes.removeAnchoredTo({ type: "drawing", id }));
    const attached = notes.attachToDrawing(label.id, id);
    notes.release(label.id, clock.nowMs, NOTE_LINGER_MS);
    if (ruling.nature !== "ink") markUnderstood(this.context, label.id);
    else if (attached !== null) store.saveNote(board.id, attached);
    const under = quietly ? null : notes.below(label.id);
    if (under !== null)
      this.voice.write(ruling.line, under, { lifetimeMs: REMARK_LIFETIME_MS, drift: "down" });
    stuck.progress(clock.nowMs);
    for (const transition of director.named(id, ruling)) this.embody(transition);
    if (ledger.get(id) !== null) void this.tidier.tidy(id, ruling.name);
  }

  /** Kami names a drawing of his own, writing the word beside it, without a word more. */
  async label(drawing: Drawing, word: string): Promise<void> {
    const current = this.context.clock.pageGuard();
    const ruling = await this.context.modules.cat.name(word, drawing);
    if (!current() || this.context.ledger.get(drawing.id) === null) return;
    this.name(drawing.id, ruling, this.hangLabel(ruling.name, guessCornerOf(drawing.strokes)), {
      quietly: true,
    });
  }

  /** The one kind of note of Kami's that is kept and saved: a name he hangs on a drawing. */
  hangLabel(name: string, corner: Vec): Note {
    const label = this.voice.write(name, corner, { drift: "down" });
    this.keeping.keepLabel(label.id);
    return label;
  }

  /** Only while she is a soul waiting for a body. */
  private nearestSoul(): NearInk | null {
    if (this.context.director.state.kind === "body") return null;
    const { soul, drawings } = this.context.modules.sim.snapshot();
    if (soul === null) return null;
    return nearestInk(soul.at, drawings, this.context.ledger, (record) => record.ruling === null);
  }
}
