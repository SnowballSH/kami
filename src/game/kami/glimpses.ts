import type { Cat } from "../../cat/types";
import type { Stroke } from "../../core/geometry";
import type { InkSession } from "../../ink/types";
import type { NoteId } from "../../notes/types";
import type { Sighting } from "../../recognition/types";
import type { GameClock } from "../context";
import type { NoteBook } from "../noteBook";
import { guessCornerOf } from "./naming";
import type { Voice } from "./voice";

const GLIMPSE_LIFETIME_MS = 8_000;

/**
 * Kami peeks at the ink between strokes and pencils in his best guess so far. Looks never queue
 * up: a stroke landing mid-look earns exactly one more look once this one is back.
 */
export class Glimpses {
  private looking = false;
  private lookAgain = false;
  private shown: { readonly noteId: NoteId; readonly word: string } | null = null;

  constructor(
    private readonly cat: Pick<Cat, "glimpse">,
    private readonly ink: Pick<InkSession, "activeStrokes" | "isDrawing">,
    private readonly notes: NoteBook,
    private readonly voice: Voice,
    private readonly clock: GameClock,
  ) {}

  async look(): Promise<void> {
    if (this.looking) {
      this.lookAgain = true;
      return;
    }
    this.looking = true;
    const current = this.clock.pageGuard();
    try {
      do {
        this.lookAgain = false;
        const strokes = this.ink.activeStrokes.map((stroke) => [...stroke]);
        const seen = await this.cat.glimpse(strokes);
        if (!current() || !this.ink.isDrawing) return;
        if (seen !== null) this.show(seen, strokes);
      } while (this.lookAgain);
    } finally {
      this.looking = false;
    }
  }

  /** The guess leaves once the ink under it has landed. */
  forget(): void {
    if (this.shown === null) return;
    this.notes.remove(this.shown.noteId);
    this.shown = null;
  }

  /** The page was opened afresh and every note with it. */
  reset(): void {
    this.shown = null;
  }

  private show(seen: Sighting, strokes: readonly Stroke[]): void {
    if (this.shown?.word === seen.word) return;
    this.forget();
    const note = this.voice.write(`${seen.name}?`, guessCornerOf(strokes), {
      lifetimeMs: GLIMPSE_LIFETIME_MS,
      drift: "down",
      spoken: false,
    });
    this.shown = { noteId: note.id, word: seen.word };
  }
}
