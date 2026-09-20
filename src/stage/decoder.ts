import type { BoardDefinition } from "../board/types";
import type { PenScript } from "../handwriting/types";
import type { Drawing, DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import type { RenderFrame } from "../render/types";
import type { LawListing } from "../ui/types";
import type { LeanFrame, ShownMessage, Viewport } from "./wire";

/** What a screen shows next: the source's frame made whole again, and the canvas it was made for. */
export interface StagedFrame {
  readonly frame: RenderFrame;
  readonly viewport: Viewport;
}

export interface StageAudience {
  boardChanged(board: BoardDefinition): void;
  lawsChanged(laws: readonly LawListing[]): void;
  frameArrived(staged: StagedFrame): void;
}

/** The screen's half of `StageEncoder`: keeps the strokes and scripts frames leave out. */
export class StageDecoder {
  #inks = new Map<DrawingId, Drawing>();
  #scripts = new Map<NoteId, PenScript>();

  constructor(private readonly audience: StageAudience) {}

  /** A new source, or none: nothing kept belongs to what comes next. */
  clear(): void {
    this.#inks.clear();
    this.#scripts.clear();
  }

  take(message: ShownMessage): void {
    switch (message.kind) {
      case "board":
        this.clear();
        this.audience.boardChanged(message.body);
        return;
      case "laws":
        this.audience.lawsChanged(message.body);
        return;
      case "ink":
        this.#inks.set(message.body.id, message.body);
        return;
      case "note":
        this.#scripts.set(message.body.id, message.body.script);
        return;
      case "frame":
        this.audience.frameArrived(this.#whole(message.body));
        return;
    }
  }

  /** Inks and notes whose strokes never arrived (a dropped connection mid-tell) are left out. */
  #whole({ viewport, inks, notes, ...rest }: LeanFrame): StagedFrame {
    const drawn = inks.flatMap(({ id, ...ink }) => {
      const drawing = this.#inks.get(id);
      return drawing === undefined ? [] : [{ ...ink, drawing }];
    });
    const written = notes.flatMap((note) => {
      const script = this.#scripts.get(note.id);
      return script === undefined ? [] : [{ ...note, script }];
    });
    this.#keepOnly(new Set(inks.map(({ id }) => id)), new Set(notes.map(({ id }) => id)));
    return { frame: { ...rest, inks: drawn, notes: written }, viewport };
  }

  #keepOnly(inks: ReadonlySet<DrawingId>, notes: ReadonlySet<NoteId>): void {
    for (const id of this.#inks.keys()) if (!inks.has(id)) this.#inks.delete(id);
    for (const id of this.#scripts.keys()) if (!notes.has(id)) this.#scripts.delete(id);
  }
}
