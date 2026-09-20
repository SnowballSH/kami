import type { PenPoint, Pose, Rect, Stroke } from "../core/geometry";

export type DrawingId = string & { readonly __brand: "DrawingId" };

export interface Drawing {
  readonly id: DrawingId;
  readonly strokes: readonly Stroke[];
  /** Ink spent: total stroke length in world px. */
  readonly cost: number;
}

export type PlacementVerdict =
  | "ok"
  | "overlaps-alice"
  | "no-ink-zone"
  | "under-ground"
  | "too-detailed"
  | "out-of-bounds";
export type PlacementRejection = Exclude<PlacementVerdict, "ok">;

export interface PlacementRules {
  readonly noInkZones: readonly Rect[];
  readonly solids: readonly Rect[];
  readonly aliceBounds: Rect | null;
}

export interface InkBudget {
  readonly total: number;
  /** What is left after committed drawings and the strokes currently being drawn. */
  readonly remaining: number;
}

export interface InkSessionListener {
  onCommit(drawing: Drawing): void;
  /** The strokes could not land there; they may still have been words. */
  onReject(reason: PlacementRejection, strokes: readonly Stroke[]): void;
}

export interface InkSession {
  /** True from pen-down until the pending drawing commits or is rejected. Drives bullet-time. */
  readonly isDrawing: boolean;
  readonly activeStrokes: readonly Stroke[];
  readonly activeVerdict: PlacementVerdict;
  readonly budget: InkBudget;
  penDown(point: PenPoint): void;
  penMove(point: PenPoint): void;
  penUp(): void;
  /** Abandons the stroke in progress (a second finger landed: it was a pinch, not a line). */
  penCancel(): void;
  /** Called every frame. Advances the commit timer and refreshes `activeVerdict`. */
  update(nowMs: number, rules: PlacementRules): void;
  refund(cost: number): void;
  /** New board or board reset: drops pending strokes and refills the pen. Infinity is a whiteboard marker. */
  reset(totalInk: number): void;
}

export interface PosedDrawing {
  readonly drawing: Drawing;
  readonly pose: Pose;
}
