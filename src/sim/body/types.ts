import type { Stroke, Vec } from "../../core/geometry";

export const BODY_PARTS = ["head", "torso", "arms", "legs", "wings"] as const;

export type BodyPartKind = (typeof BODY_PARTS)[number];

/** One of her strokes, in body coordinates: origin at her middle, facing right, at the size she was drawn. */
export interface BodyStroke {
  readonly stroke: Stroke;
  readonly part: BodyPartKind;
  readonly sinceMs: number;
}

export interface Abilities {
  readonly walk: boolean;
  readonly jump: boolean;
  readonly climb: boolean;
  readonly fly: boolean;
  readonly see: boolean;
}

export interface BodyFrame {
  readonly width: number;
  readonly height: number;
}

/**
 * A body made of the strokes that were drawn for it. `fullest` is the most ink each part has ever
 * had: a part is alive while it keeps enough of that, and comes back once it is redrawn to it.
 */
export interface DrawnBody {
  readonly strokes: readonly BodyStroke[];
  readonly heart: Vec;
  readonly frame: BodyFrame;
  readonly fullest: Readonly<Record<BodyPartKind, number>>;
}

export interface Cut {
  readonly from: Vec;
  readonly to: Vec;
}

export interface Snipped {
  readonly body: DrawnBody;
  readonly removed: readonly BodyStroke[];
  readonly lost: readonly BodyPartKind[];
  readonly heartCut: boolean;
}

export interface Grafted {
  readonly body: DrawnBody;
  readonly added: readonly BodyStroke[];
  readonly restored: readonly BodyPartKind[];
}
