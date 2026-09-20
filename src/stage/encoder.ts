import type { BoardDefinition } from "../board/types";
import type { Stroke } from "../core/geometry";
import type { PenScript } from "../handwriting/types";
import type { DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import type { RenderFrame } from "../render/types";
import type { SimEvent } from "../sim/types";
import type { LawListing } from "../ui/types";
import { type LeanFrame, pack, type Viewport } from "./wire";

/**
 * Turns what the renderer is shown into stage messages. A drawing's strokes and a note's script
 * travel once, and again only when the game hands the renderer a different array for them; the
 * frames in between carry poses alone. `startOver` makes the next frame tell everything again.
 */
export class StageEncoder {
  #board: BoardDefinition | null = null;
  #laws: readonly LawListing[] = [];
  #boardTold = false;
  #lawsTold = false;
  #inksTold = new Map<DrawingId, readonly Stroke[]>();
  #notesTold = new Map<NoteId, PenScript>();
  #unshown: SimEvent[] = [];

  setBoard(board: BoardDefinition): void {
    this.#board = board;
    this.#boardTold = false;
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
    for (const { drawing } of frame.inks) {
      if (this.#inksTold.get(drawing.id) === drawing.strokes) continue;
      messages.push(pack("ink", drawing));
      this.#inksTold.set(drawing.id, drawing.strokes);
    }
    for (const { id, script } of frame.notes) {
      if (this.#notesTold.get(id) === script) continue;
      messages.push(pack("note", { id, script }));
      this.#notesTold.set(id, script);
    }
    this.#forgetAllBut(frame);
    messages.push(pack("frame", this.#lean(frame, viewport)));
    return messages;
  }

  #lean(frame: RenderFrame, viewport: Viewport): LeanFrame {
    const events = [...this.#unshown, ...(frame.events ?? [])];
    this.#unshown = [];
    return {
      ...frame,
      inks: frame.inks.map(({ drawing, ...ink }) => ({ ...ink, id: drawing.id })),
      notes: frame.notes.map(({ script: _script, ...note }) => note),
      events,
      viewport,
    };
  }

  #forgetAllBut(frame: RenderFrame): void {
    const inks = new Set(frame.inks.map(({ drawing }) => drawing.id));
    const notes = new Set(frame.notes.map(({ id }) => id));
    for (const id of this.#inksTold.keys()) if (!inks.has(id)) this.#inksTold.delete(id);
    for (const id of this.#notesTold.keys()) if (!notes.has(id)) this.#notesTold.delete(id);
  }
}
