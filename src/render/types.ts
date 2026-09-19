import type { Nature } from "../cat/types";
import type { Pose, Stroke, Vec } from "../core/geometry";
import type { LevelDefinition } from "../game/types";
import type { Drawing, PlacementVerdict } from "../ink/types";
import type { WorldSnapshot } from "../sim/types";

export interface InkView {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly nature: Nature;
  /** When the ruling landed, for the shiver-and-tint beat. Null while it is still unnamed. */
  readonly awakenedAtMs: number | null;
}

export interface RenderFrame {
  readonly nowMs: number;
  readonly world: WorldSnapshot;
  readonly inks: readonly InkView[];
  readonly activeStrokes: readonly Stroke[];
  readonly activeVerdict: PlacementVerdict;
  readonly bulletTime: boolean;
  readonly eraserActive: boolean;
}

export interface Renderer {
  /** Pre-renders the static page for a room. */
  setLevel(level: LevelDefinition): void;
  /** Refits the WORLD into the canvas's current CSS box, letterboxed, at device pixel ratio. */
  resize(): void;
  /** Client (CSS px) coordinates to world coordinates. */
  toWorld(clientX: number, clientY: number): Vec;
  render(frame: RenderFrame): void;
  /** A square portrait of one drawing, for the ending flip-through. */
  thumbnail(drawing: Drawing, sizePx: number): HTMLCanvasElement;
}
