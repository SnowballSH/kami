import type { Nature, Ruling } from "../cat/types";
import type { Pose, Rect, Vec } from "../core/geometry";
import type { PhysicsState } from "../core/physics";
import type { LevelDefinition } from "../game/types";
import type { Drawing, DrawingId } from "../ink/types";

export type AliceSize = "small" | "normal" | "big";

export const ALICE_SCALE: Readonly<Record<AliceSize, number>> = { small: 0.5, normal: 1, big: 2 };

export const ALICE_BASE = { width: 28, height: 60 } as const;

/** She takes the key when it lies within `radius` of her bounds grown by `reachRatio` × height. */
export const KEY_PICKUP = { radius: 18, reachRatio: 0.5 } as const;

/** Which natures get in her way, so a planner can read the page the way her feet do. */
export const NATURE_FOOTING: Readonly<
  Record<Nature, { readonly solid: boolean; readonly climbable: boolean; readonly edible: boolean }>
> = {
  ink: { solid: true, climbable: false, edible: false },
  bouncy: { solid: true, climbable: false, edible: false },
  climbable: { solid: false, climbable: true, edible: false },
  floaty: { solid: true, climbable: false, edible: false },
  heavy: { solid: true, climbable: false, edible: false },
  light: { solid: true, climbable: false, edible: false },
  slippery: { solid: true, climbable: false, edible: false },
  sticky: { solid: true, climbable: false, edible: false },
  grow: { solid: true, climbable: false, edible: true },
  shrink: { solid: true, climbable: false, edible: true },
};

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
  | { readonly type: "exit-reached" }
  | { readonly type: "fell" }
  | { readonly type: "key-taken" }
  | { readonly type: "door-opened" }
  | { readonly type: "bounced"; readonly drawingId: DrawingId }
  | { readonly type: "consumed"; readonly drawingId: DrawingId; readonly nature: Nature }
  | { readonly type: "grow-blocked"; readonly drawingId: DrawingId };

export interface Simulation {
  /** Discards the whole world and rebuilds it with Alice standing at `level.spawn`. */
  loadLevel(level: LevelDefinition): void;
  /** Ink is solid the moment it commits — as plain ink, before anyone has named it. */
  addDrawing(drawing: Drawing): void;
  applyRuling(id: DrawingId, ruling: Ruling): void;
  removeDrawing(id: DrawingId): void;
  setWalkIntent(intent: WalkIntent): void;
  /** 1 is real time; bullet-time passes BULLET_TIME_SCALE. Multiplies `physics.timeScale`. */
  setTimeScale(scale: number): void;
  /** The writable laws of the room. Survives `loadLevel`; `resetPhysics` restores the defaults. */
  physics(): PhysicsState;
  setPhysics(patch: Partial<PhysicsState>): void;
  resetPhysics(): void;
  /** Alice's walking speed in px per tick at her current size and `walkSpeedFactor`. */
  walkSpeed(): number;
  /** Starts the 400 ms resize tween, as eating would. No-op if there is no headroom. */
  resizeAlice(size: AliceSize): void;
  /** The arc a bounce of `strength` throws her on under the current gravity. */
  bounceArc(strength: number): BounceArc;
  /** World-space bounds and static-ness of every live drawing. */
  drawingFacts(): readonly DrawingBodyFact[];
  /** Advances one fixed step (FIXED_STEP_MS) and reports what happened during it. */
  step(): readonly SimEvent[];
  snapshot(): WorldSnapshot;
  aliceBounds(): Rect;
}

export interface BounceArc {
  /** Rise from launch to apex, px. */
  readonly apexPx: number;
  /** Ticks from launch to apex. */
  readonly ticksToApex: number;
  /** Ticks in the air until she is back down to `risePx` above the launch point, or null if the arc never gets that high. */
  ticksAloftAbove(risePx: number): number | null;
}

export interface DrawingBodyFact {
  readonly id: DrawingId;
  readonly bounds: Rect;
  readonly isStatic: boolean;
}
