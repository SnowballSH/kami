import type { BoardDefinition } from "../board/types";
import type { RenderFrame } from "../render/types";
import type { LawListing } from "../ui/types";
import { StageEncoder } from "./encoder";
import { type DialStage, KeptLine, type Schedule } from "./line";
import { kindOf, pack, type Viewport } from "./wire";

/** About thirty frames a second however fast the device paints. */
export const MIN_FRAME_GAP_MS = 30;
/** A screen on a slow link gets fewer frames rather than later ones. */
export const MOST_BUFFERED_BYTES = 256 * 1024;
const ACTIVE_EVERY_MS = 1000;

const isBusy = (frame: RenderFrame): boolean =>
  frame.activeStrokes.length > 0 || frame.heldInks.length > 0;

/**
 * A playing device's end of the stage. It shows nothing until the server says a screen is watching
 * it (`go`), so a game nobody watches pays for one idle socket and nothing else; while it rests it
 * only says when someone is drawing, which is how the stage passes to the device in use.
 */
export class StageSource {
  readonly #encoder = new StageEncoder();
  readonly #line: KeptLine;
  #live = false;
  #shownAtMs = Number.NEGATIVE_INFINITY;
  #activeSaidAtMs = Number.NEGATIVE_INFINITY;

  constructor(dial: DialStage, schedule?: Schedule, chance?: () => number) {
    this.#line = new KeptLine(
      dial,
      {
        opened: () => {},
        message: (text) => this.#directed(kindOf(text)),
        closed: () => {
          this.#live = false;
        },
      },
      schedule,
      chance,
    );
  }

  setBoard(board: BoardDefinition): void {
    this.#encoder.setBoard(board);
  }

  setLaws(laws: readonly LawListing[]): void {
    this.#encoder.setLaws(laws);
  }

  show(frame: RenderFrame, viewport: Viewport): void {
    if (!this.#line.open) return;
    if (isBusy(frame) && frame.nowMs - this.#activeSaidAtMs >= ACTIVE_EVERY_MS) {
      this.#line.send(pack("active"));
      this.#activeSaidAtMs = frame.nowMs;
    }
    if (!this.#live) return;
    const tooSoon = frame.nowMs - this.#shownAtMs < MIN_FRAME_GAP_MS;
    if (tooSoon || this.#line.buffered() > MOST_BUFFERED_BYTES) {
      this.#encoder.skip(frame);
      return;
    }
    for (const message of this.#encoder.encode(frame, viewport)) this.#line.send(message);
    this.#shownAtMs = frame.nowMs;
  }

  #directed(kind: string): void {
    if (kind === "go") {
      this.#encoder.startOver();
      this.#live = true;
    } else if (kind === "rest") {
      this.#live = false;
    }
  }
}
