import type { BoardDefinition } from "../board/types";
import type { PenScript } from "../handwriting/types";
import type { Drawing, DrawingId } from "../ink/types";
import type { NoteId } from "../notes/types";
import type { RenderFrame } from "../render/types";
import type { DrawnBody } from "../sim/body/types";
import type { AliceSnapshot } from "../sim/types";
import type { LawListing } from "../ui/types";
import type { LeanAlice, LeanFrame, ShownMessage, Viewport } from "./wire";

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
  #bodies = new Map<number, DrawnBody>();

  constructor(private readonly audience: StageAudience) {}

  /** A new source, or none: nothing kept belongs to what comes next. */
  clear(): void {
    this.#inks.clear();
    this.#scripts.clear();
    this.#bodies.clear();
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
      case "body":
        this.#bodies.set(message.body.ref, message.body.body);
        return;
      case "frame":
        this.audience.frameArrived(this.#whole(message.body));
        return;
    }
  }

  /** A drawn Alice whose body never arrived is shown as Kami's own sketch of her. */
  #herself(alice: LeanAlice): AliceSnapshot {
    if (alice.look.kind === "alice") return { ...alice, look: alice.look };
    const { bodyRef, ...look } = alice.look;
    const body = this.#bodies.get(bodyRef);
    return { ...alice, look: body === undefined ? { kind: "alice" } : { ...look, body } };
  }

  /** Inks and notes whose strokes never arrived (a dropped connection mid-tell) are left out. */
  #whole({ viewport, inks, notes, world, ghosts, ...rest }: LeanFrame): StagedFrame {
    const drawn = inks.flatMap(({ id, ...ink }) => {
      const drawing = this.#inks.get(id);
      return drawing === undefined ? [] : [{ ...ink, drawing }];
    });
    const written = notes.flatMap((note) => {
      const script = this.#scripts.get(note.id);
      return script === undefined ? [] : [{ ...note, script }];
    });
    this.#keepOnly(new Set(inks.map(({ id }) => id)), new Set(notes.map(({ id }) => id)));
    const whole = {
      ...world,
      alice: world.alice === null ? null : this.#herself(world.alice),
      twins: world.twins.map((twin) => this.#herself(twin)),
    };
    const others = ghosts === undefined ? {} : { ghosts: ghosts.map((one) => this.#herself(one)) };
    return { frame: { ...rest, ...others, world: whole, inks: drawn, notes: written }, viewport };
  }

  #keepOnly(inks: ReadonlySet<DrawingId>, notes: ReadonlySet<NoteId>): void {
    for (const id of this.#inks.keys()) if (!inks.has(id)) this.#inks.delete(id);
    for (const id of this.#scripts.keys()) if (!notes.has(id)) this.#scripts.delete(id);
  }
}
