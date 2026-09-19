import type { BoardDefinition } from "../board/types";
import type { Nature, Ruling } from "../cat/types";
import type { Pose, Rect, Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { WorldPhysics } from "../rules/types";

export type AliceSize = "small" | "normal" | "big";

export const ALICE_SCALE: Readonly<Record<AliceSize, number>> = { small: 0.5, normal: 1, big: 2 };

export const ALICE_BASE = { width: 28, height: 60 } as const;

/** She takes the key when it lies within `radius` of her body grown by `reachRatio` of her height. */
export const KEY_PICKUP = { reachRatio: 0.5, radius: 18 } as const;

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

/** The flight a bounce throws Alice on, tick by tick, under the standing physics. */
export interface BounceArc {
  /** Rise from launch to apex, px. */
  readonly apexPx: number;
  readonly ticksToApex: number;
  /** Ticks in the air until she is back down to `risePx` above the launch point, or null if the arc never gets that high. */
  ticksAloftAbove(risePx: number): number | null;
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
  /** Her walking speed at her current size, px per tick. */
  walkSpeed(): number;
  /** Where a spring of `strength` would throw her under the standing physics. */
  bounceArc(strength: number): BounceArc;
  /** The flight a jump from standing throws her on, at her current size. */
  jumpArc(): BounceArc;
}
