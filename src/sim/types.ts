import type { BoardDefinition } from "../board/types";
import type { Nature, Ruling } from "../cat/types";
import type { Pose, Rect, Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { WorldPhysics } from "../rules/types";

export type AliceSize = "small" | "normal" | "big";

export const ALICE_SCALE: Readonly<Record<AliceSize, number>> = { small: 0.5, normal: 1, big: 2 };

export const ALICE_BASE = { width: 28, height: 60 } as const;

export type Axis = -1 | 0 | 1;

/** `y` is only used while she overlaps something climbable: -1 is up. */
export interface WalkIntent {
  readonly x: Axis;
  readonly y: Axis;
}

export interface AliceSnapshot {
  readonly center: Vec;
  /** Current body size, mid-tween while she is growing or shrinking. */
  readonly width: number;
  readonly height: number;
  readonly size: AliceSize;
  readonly facing: -1 | 1;
  readonly walking: boolean;
  readonly grounded: boolean;
  readonly climbing: boolean;
  readonly hasKey: boolean;
}

export interface DrawingPose {
  readonly id: DrawingId;
  readonly pose: Pose;
}

export interface WorldSnapshot {
  readonly alice: AliceSnapshot;
  /** Live drawings only; consumed and removed ones are gone. */
  readonly drawings: readonly DrawingPose[];
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
}

export type SimEvent =
  | { readonly type: "goal-reached" }
  | { readonly type: "fell" }
  | { readonly type: "zone-entered"; readonly zoneId: string }
  | { readonly type: "key-taken" }
  | { readonly type: "door-opened" }
  | { readonly type: "bounced"; readonly drawingId: DrawingId }
  | { readonly type: "consumed"; readonly drawingId: DrawingId; readonly nature: Nature }
  | { readonly type: "grow-blocked"; readonly drawingId: DrawingId };

export interface Simulation {
  /** Discards the whole world and rebuilds it with Alice standing at `board.spawn`. */
  loadBoard(board: BoardDefinition): void;
  /** The standing rules of the board. Survives `loadBoard`; applies from the next step. */
  setPhysics(physics: WorldPhysics): void;
  /** Ink is solid the moment it commits — as plain ink, before anyone has named it. */
  addDrawing(drawing: Drawing): void;
  applyRuling(id: DrawingId, ruling: Ruling): void;
  removeDrawing(id: DrawingId): void;
  setWalkIntent(intent: WalkIntent): void;
  /** 1 is real time; bullet-time passes BULLET_TIME_SCALE. */
  setTimeScale(scale: number): void;
  /** Advances one fixed step (FIXED_STEP_MS) and reports what happened during it. */
  step(): readonly SimEvent[];
  snapshot(): WorldSnapshot;
  aliceBounds(): Rect;
}
