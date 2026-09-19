import type { Nature } from "../cat/types";
import type { Pose, Rect, Stroke, Vec } from "../core/geometry";
import type { LevelDefinition } from "../game/types";
import type { Drawing, DrawingId, PlacementVerdict } from "../ink/types";
import type { WorldSnapshot } from "../sim/types";

export interface InkView {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly nature: Nature;
  /** When the ruling landed, for the shiver-and-tint beat. Null while it is still unnamed. */
  readonly awakenedAtMs: number | null;
}

/** Ink that has left the world but is still fading off the page — handwriting the Cat has read. */
export interface GhostInk {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly fadeStartMs: number;
  readonly fadeMs: number;
}

/**
 * A picture to draw in place of a drawing's ink. `frame` is the rectangle, in the drawing's
 * own drawn frame (pre-pose), that the image should be stretched over. Physics never sees it.
 */
export interface DrawingArt {
  readonly image: CanvasImageSource;
  readonly frame: Rect;
}

export interface RenderFrame {
  readonly nowMs: number;
  readonly world: WorldSnapshot;
  readonly inks: readonly InkView[];
  readonly ghosts: readonly GhostInk[];
  readonly activeStrokes: readonly Stroke[];
  readonly activeVerdict: PlacementVerdict;
  readonly bulletTime: boolean;
  readonly eraserActive: boolean;
  /** Alice has gone as far as she can and is looking at the player. */
  readonly aliceWaiting: boolean;
}

export interface Renderer {
  /** Pre-renders the static page for a room. */
  setLevel(level: LevelDefinition): void;
  /** Refits the WORLD into the canvas's current CSS box, letterboxed, at device pixel ratio. */
  resize(): void;
  /** Client (CSS px) coordinates to world coordinates. */
  toWorld(clientX: number, clientY: number): Vec;
  render(frame: RenderFrame): void;
  /** A square portrait of one drawing, for the ending flip-through and for the Cat's eyes. */
  thumbnail(drawing: Drawing, sizePx: number): HTMLCanvasElement;
  /** Dress a drawing in generated art; null undresses it. Forgotten on `setLevel`. */
  setArt(id: DrawingId, art: DrawingArt | null): void;
}
