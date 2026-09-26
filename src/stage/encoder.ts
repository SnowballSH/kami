import type { BoardDefinition } from "../board/types";
import type { Stroke } from "../core/geometry";
import type { PenScript } from "../handwriting/types";
import type { InkMotion } from "../ink/retrace";
import type { DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import type { InkView, RenderFrame } from "../render/types";
import type { DrawnBody } from "../sim/body/types";
import type { AliceSnapshot, SimEvent } from "../sim/types";
import type { LawListing } from "../ui/types";
import { type LeanAlice, type LeanFrame, pack, type StagedInk, type Viewport } from "./wire";

interface ToldInk {
  readonly strokes: readonly Stroke[];
  readonly motion: InkMotion | undefined;
}

const stagedOf = ({ drawing, settling }: InkView): StagedInk =>
  settling === undefined ? drawing : { ...settling.drawing, motion: settling.motion };

/** A motion that has played out needs no telling: the screen has already landed on the strokes. */
const alreadyTold = (told: ToldInk | undefined, ink: StagedInk): boolean =>
  told?.strokes === ink.strokes && (ink.motion === undefined || told.motion === ink.motion);

const COORDINATE_DECIMALS = 1;
const PRESSURE_DECIMALS = 2;

const rounded = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

/** Ink still under the pen goes out every frame, so it goes out short: a tenth of a pixel is plenty. */
const briefly = (strokes: readonly Stroke[]): Stroke[] =>
  strokes.map((stroke) =>
    stroke.map(({ x, y, pressure }) => ({
      x: rounded(x, COORDINATE_DECIMALS),
      y: rounded(y, COORDINATE_DECIMALS),
      ...(pressure === undefined ? {} : { pressure: rounded(pressure, PRESSURE_DECIMALS) }),
    })),
  );

/**
 * Turns what the renderer is shown into stage messages. A drawing's strokes, a note's script and a
 * body the player drew for Alice travel once, and again only when the game hands the renderer a
 * different object for them; the frames in between carry poses alone. Ink still coming in travels
 * as its final strokes and its motion, once, not as the strokes of each frame. A new board, like
 * `startOver`, makes the next frame tell everything again: the screen forgets what it kept
 * whenever it is told a board.
 */
export class StageEncoder {
  #board: BoardDefinition | null = null;
  #laws: readonly LawListing[] = [];
  #boardTold = false;
  #lawsTold = false;
  #inksTold = new Map<DrawingId, ToldInk>();
  #notesTold = new Map<NoteId, PenScript>();
  #bodiesTold = new Map<DrawnBody, number>();
  #bodiesMinted = 0;
  #unshown: SimEvent[] = [];

  setBoard(board: BoardDefinition): void {
    this.#board = board;
    this.startOver();
  }

  setLaws(laws: readonly LawListing[]): void {
    this.#laws = laws;
    this.#lawsTold = false;
  }

  startOver(): void {
    this.#boardTold = false;
    this.#lawsTold = false;
    this.#inksTold.clear();
    this.#notesTold.clear();
    this.#bodiesTold.clear();
    this.#unshown = [];
  }

  /** A frame that is not sent still happened: its events ride with the next one that is. */
  skip(frame: RenderFrame): void {
    this.#unshown.push(...(frame.events ?? []));
  }

  encode(frame: RenderFrame, viewport: Viewport): string[] {
    const messages: string[] = [];
    if (!this.#boardTold && this.#board !== null) {
      messages.push(pack("board", this.#board));
      this.#boardTold = true;
    }
    if (!this.#lawsTold) {
      messages.push(pack("laws", this.#laws));
      this.#lawsTold = true;
    }
    for (const view of frame.inks) {
      const ink = stagedOf(view);
      if (alreadyTold(this.#inksTold.get(ink.id), ink)) continue;
      messages.push(pack("ink", ink));
      this.#inksTold.set(ink.id, { strokes: ink.strokes, motion: ink.motion });
    }
    for (const { id, script } of frame.notes) {
      if (this.#notesTold.get(id) === script) continue;
      messages.push(pack("note", { id, script }));
      this.#notesTold.set(id, script);
    }
    const seen = new Set<DrawnBody>();
    const lean = this.#lean(frame, viewport, (alice) => this.#leanAlice(alice, seen, messages));
    this.#forgetAllBut(frame, seen);
    messages.push(pack("frame", lean));
    return messages;
  }

  #lean(
    frame: RenderFrame,
    viewport: Viewport,
    leanAlice: (alice: AliceSnapshot) => LeanAlice,
  ): LeanFrame {
    const events = [...this.#unshown, ...(frame.events ?? [])];
    this.#unshown = [];
    const { ghosts, world, ...rest } = frame;
    return {
      ...rest,
      world: {
        ...world,
        alice: world.alice === null ? null : leanAlice(world.alice),
        twins: world.twins.map(leanAlice),
      },
      ...(ghosts === undefined ? {} : { ghosts: ghosts.map(leanAlice) }),
      inks: frame.inks.map(({ drawing, settling: _settling, ...ink }) => ({
        ...ink,
        id: drawing.id,
      })),
      notes: frame.notes.map(({ script: _script, ...note }) => note),
      activeStrokes: briefly(frame.activeStrokes),
      heldInks: frame.heldInks.map((held) => ({ ...held, strokes: briefly(held.strokes) })),
      events,
      viewport,
    };
  }

  #leanAlice(alice: AliceSnapshot, seen: Set<DrawnBody>, messages: string[]): LeanAlice {
    if (alice.look.kind === "alice") return { ...alice, look: alice.look };
    const { body, ...look } = alice.look;
    seen.add(body);
    let ref = this.#bodiesTold.get(body);
    if (ref === undefined) {
      ref = this.#bodiesMinted++;
      this.#bodiesTold.set(body, ref);
      messages.push(pack("body", { ref, body }));
    }
    return { ...alice, look: { ...look, bodyRef: ref } };
  }

  #forgetAllBut(frame: RenderFrame, bodies: ReadonlySet<DrawnBody>): void {
    const inks = new Set(frame.inks.map(({ drawing }) => drawing.id));
    const notes = new Set(frame.notes.map(({ id }) => id));
    for (const id of this.#inksTold.keys()) if (!inks.has(id)) this.#inksTold.delete(id);
    for (const id of this.#notesTold.keys()) if (!notes.has(id)) this.#notesTold.delete(id);
    for (const body of this.#bodiesTold.keys())
      if (!bodies.has(body)) this.#bodiesTold.delete(body);
  }
}
