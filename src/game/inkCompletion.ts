import { boundsOf, clamp, type Stroke } from "../core/geometry";
import { lerp } from "../handwriting/resample";
import { revealStrokes } from "../handwriting/reveal";
import { scheduleStrokes } from "../handwriting/timing";
import type { PenScript } from "../handwriting/types";
import type { Drawing } from "../ink/types";
import type { Completion } from "../recognition/types";

const TIDY_MS = 350;
const MAX_ADDED_MS = 1_200;

export class InkCompletion {
  readonly drawing: Drawing;
  private readonly script: PenScript;
  private readonly addedMs: number;

  constructor(
    private readonly original: Drawing,
    private readonly completion: Completion,
    private readonly startedAtMs: number,
  ) {
    this.drawing = { ...original, strokes: [...completion.tidied, ...completion.added] };
    this.script = {
      text: "",
      strokes: completion.added,
      bounds: boundsOf(this.drawing.strokes.flat()),
      ...scheduleStrokes(
        completion.added.map((points, i) => ({ points, lift: i === 0 ? "start" : "stroke" })),
        28,
      ),
    };
    this.addedMs = Math.min(MAX_ADDED_MS, this.script.durationMs);
  }

  done(nowMs: number): boolean {
    return nowMs >= this.startedAtMs + TIDY_MS + this.addedMs;
  }

  strokesAt(nowMs: number): readonly Stroke[] {
    const elapsed = nowMs - this.startedAtMs;
    if (elapsed <= 0) return this.original.strokes;
    if (this.done(nowMs)) return this.drawing.strokes;
    const progress = clamp(elapsed / TIDY_MS, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    const tidied =
      progress === 1
        ? this.completion.tidied
        : this.original.strokes.map((stroke, i) =>
            stroke.map((point, j) => lerp(point, this.completion.tidied[i]?.[j] ?? point, eased)),
          );
    const added =
      this.addedMs === 0
        ? []
        : revealStrokes(this.script, ((elapsed - TIDY_MS) / this.addedMs) * this.script.durationMs);
    return [...tidied, ...added];
  }
}
