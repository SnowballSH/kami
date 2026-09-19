import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Pose, Vec } from "../core/geometry";
import type { Drawing } from "../ink/types";
import type { AliceSnapshot, BounceArc, WalkIntent } from "../sim/types";

export interface SceneInk {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly nature: Nature;
  readonly strength: number;
}

/** What Alice can see: the board as sketched, the ink as it lies now, and herself. */
export interface Scene {
  readonly board: BoardDefinition;
  readonly alice: AliceSnapshot;
  readonly inks: readonly SceneInk[];
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
  /** Walking speed in px per tick at her current size, so the planner can model flight. */
  readonly walkSpeed: number;
  /** The arc a bounce of the given strength throws her on under the standing physics. */
  readonly bounceArc: (strength: number) => BounceArc;
  readonly jumpArc: BounceArc;
}

export type Objective = "key" | "door" | "goal";

export type Errand =
  /** A way to the objective exists; she is on it. */
  | { readonly kind: "objective"; readonly objective: Objective }
  /** Something edible (grow/shrink) is reachable and the objective is not; go and touch it. */
  | { readonly kind: "eat"; readonly drawingId: Drawing["id"] }
  /** Nothing helps yet: walk as close to the objective as the board allows, then wait. */
  | { readonly kind: "wait"; readonly objective: Objective }
  /** The board has nothing to reach for yet — no key, door or goal. */
  | { readonly kind: "idle" };

export interface PilotStatus {
  readonly errand: Errand;
  /** True once she has come to the end of what is possible and is looking at the player. */
  readonly stuck: boolean;
  readonly target: Vec | null;
}

/**
 * Alice's own mind. Deterministic, offline, and re-planned every few ticks: the player draws,
 * Alice finds the way. She never jumps — she only walks, climbs, falls and rides what is there.
 */
export interface Autopilot {
  /** Forget the plan; called when a board opens or resets. */
  reset(): void;
  /** Force the next `drive` to re-plan, e.g. when ink was added, named or erased. */
  invalidate(): void;
  /** One call per simulation step. */
  drive(scene: Scene): WalkIntent;
  readonly status: PilotStatus;
}
