import type { RoomBrief } from "../cat/types";
import type { Rect, Vec } from "../core/geometry";

/** Glass is solid but never counts as an anchor for ink. */
export type SolidMaterial = "paper" | "glass";

export interface SolidDef {
  readonly rect: Rect;
  readonly material: SolidMaterial;
}

export interface LevelDefinition extends RoomBrief {
  readonly title: string;
  /** Shown as the Cat's caption when the room opens. */
  readonly intro: string;
  /** Ink budget in world px of stroke length. */
  readonly ink: number;
  readonly inkPar: number;
  /** False in rooms before the Cat arrives: drawings are committed as plain ink, unasked. */
  readonly namingEnabled: boolean;
  /** Where Alice's feet go (bottom-centre of her body). */
  readonly spawn: Vec;
  /** Overlapping this clears the room. Drawn as a hole torn through the page. */
  readonly exit: Rect;
  /** Falling below this line floats Alice back to `spawn`. */
  readonly killY: number;
  readonly solids: readonly SolidDef[];
  readonly noInkZones: readonly Rect[];
  /** Centre of the key, if the room has one. */
  readonly key?: Vec;
  /** Solid until Alice touches it while holding the key. */
  readonly door?: Rect;
}
