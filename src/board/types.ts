import type { RoomBrief } from "../cat/types";
import type { Rect, Vec } from "../core/geometry";

/** Glass is solid but never counts as an anchor for ink. */
export type SolidMaterial = "marker" | "glass";

export interface SolidDef {
  readonly rect: Rect;
  readonly material: SolidMaterial;
}

/** A stretch of the board with its own puzzle: from `fromX` to the next zone's `fromX`. */
export interface Zone extends RoomBrief {
  readonly title: string;
  /** Kami writes this near `checkpoint` the first time Alice arrives. */
  readonly intro: string;
  readonly fromX: number;
  /** Where Alice's feet return to if she falls while in this zone. */
  readonly checkpoint: Vec;
}

/**
 * What kind of paper a board is. A `room` is finite in spirit: spawn, checkpoints, a rabbit hole,
 * and a line below which she falls back to a checkpoint. An `endless` page has none of that; it
 * is drawn as far as anyone has drawn it, and falling puts her back on the last ink she stood on.
 */
export type PageKind = "room" | "endless" | "arena";

/**
 * A board is one endless whiteboard. Everything here is what was sketched on it before
 * the player arrived; a blank board has a patch of ground and nothing else.
 */
export interface BoardDefinition {
  readonly id: string;
  readonly title: string;
  /** A `room` unless said otherwise. */
  readonly page?: PageKind;
  /** Where Alice's feet go (bottom-centre of her body). */
  readonly spawn: Vec;
  /** Falling below this line returns Alice to her last checkpoint. */
  readonly killY: number;
  readonly solids: readonly SolidDef[];
  /** Ordered by `fromX`. May be empty. */
  readonly zones: readonly Zone[];
  readonly noInkZones: readonly Rect[];
  /** Overlapping this wins the board. Drawn as a rabbit hole. */
  readonly goal?: Rect;
  /** Centre of the key, if the board has one. */
  readonly key?: Vec;
  /** Solid until Alice touches it while holding the key. */
  readonly door?: Rect;
}
