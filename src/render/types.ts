import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Pose, Stroke, Vec } from "../core/geometry";
import type { PenScript } from "../handwriting/types";
import type { InkMotion } from "../ink/retrace";
import type { Drawing, DrawingId, PlacementVerdict } from "../ink/types";
import type { NoteAuthor, NoteId, NoteTone } from "../notes/types";
import type { AliceIndex, AliceSnapshot, SimEvent, WorldSnapshot } from "../sim/types";

/** The window onto the endless board: `center` is the world point in the middle of the canvas. */
export interface Camera {
  readonly center: Vec;
  /** Screen px per world px. */
  readonly zoom: number;
  /** How far the paper is turned on screen, in degrees clockwise about `center`. */
  readonly angle: number;
}

export interface InkView {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly nature: Nature;
  /** It lights its patch at night: a lantern, or a drawing with the `glow` power. */
  readonly lit: boolean;
  /** When the ruling landed, for the shiver-and-tint beat. Null while it is still unnamed. */
  readonly awakenedAtMs: number | null;
  /** Set while the ink is still coming in: `drawing` is what shows now, this is where it is going. */
  readonly settling?: InkSettling;
}

/** The drawing an ink settles into, and the motion that brings it there. */
export interface InkSettling {
  readonly drawing: Drawing;
  readonly motion: InkMotion;
}

/** A drawing between the Sumikui's teeth, and how far through it is. */
export interface Chew {
  readonly drawingId: DrawingId;
  readonly bite: number;
}

/** Settled strokes not yet in the world: held still while being read, then fading out as words. */
export interface HeldInkView {
  readonly strokes: readonly Stroke[];
  /** 1 while being read; drops toward 0 once the strokes were read as words. */
  readonly opacity: number;
}

export interface NoteView {
  readonly id: NoteId;
  readonly author: NoteAuthor;
  readonly tone: NoteTone;
  readonly script: PenScript;
  /** When the pen touched down; the note writes itself out from here. */
  readonly writtenAtMs: number;
  /** Tappable notes (Kami's guesses) get an underline. */
  readonly tappable: boolean;
  /** 1 is fully there; fleeting notes drop toward 0 before they are removed. */
  readonly opacity: number;
}

export interface RenderFrame {
  readonly nowMs: number;
  readonly camera: Camera;
  readonly world: WorldSnapshot;
  /** 1 is full day; toward 0 the board darkens and only lanterns and Alice show. */
  readonly daylight: number;
  readonly inks: readonly InkView[];
  readonly notes: readonly NoteView[];
  readonly activeStrokes: readonly Stroke[];
  readonly activeVerdict: PlacementVerdict;
  readonly heldInks: readonly HeldInkView[];
  readonly eraserActive: boolean;
  /** Other devices' Alices on a shared page, drawn faint. */
  readonly ghosts?: readonly AliceSnapshot[];
  /** Which Alice the player steers; marked only when there are several to tell apart. */
  readonly selectedAlice?: AliceIndex;
  /** What the simulation reported since the last frame, for beats a snapshot alone cannot show. */
  readonly events?: readonly SimEvent[];
}

export interface Renderer {
  /** Pre-renders what was sketched on the board before the player arrived. */
  setBoard(board: BoardDefinition): void;
  /** Refits the backing store to the canvas's current CSS box at device pixel ratio. */
  resize(): void;
  /** Client (CSS px) coordinates to world coordinates under `camera`. */
  toWorld(client: Vec, camera: Camera): Vec;
  /** CSS px size of the canvas, for camera maths. */
  viewport(): { readonly width: number; readonly height: number };
  render(frame: RenderFrame): void;
}
