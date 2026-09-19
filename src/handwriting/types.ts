import type { Rect, Stroke, Vec } from "../core/geometry";

export interface WriteOptions {
  /** Top-left of the first line, world space. */
  readonly origin: Vec;
  /** Line height in world px. */
  readonly size: number;
  /** Lines wrap at word boundaries past this width. */
  readonly maxWidth: number;
  /** Same text + same seed → same wobble, so a note never boils between frames. */
  readonly seed: number;
}

/** Text turned into timed pen strokes: what to draw, and when each stroke starts and ends. */
export interface PenScript {
  readonly text: string;
  readonly strokes: readonly Stroke[];
  /** Per stroke, ms from the start of writing. Same length as `strokes`. */
  readonly startsAtMs: readonly number[];
  readonly endsAtMs: readonly number[];
  readonly durationMs: number;
  readonly bounds: Rect;
}

export interface Handwriting {
  write(text: string, options: WriteOptions): PenScript;
  /** The strokes as they stand `elapsedMs` into writing; the stroke in progress is cut short. */
  reveal(script: PenScript, elapsedMs: number): readonly Stroke[];
}
