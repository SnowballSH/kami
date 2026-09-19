import type { Nature } from "../cat/types";
import type { Pose, Vec } from "../core/geometry";
import type { LevelDefinition } from "../game/types";
import type { Drawing } from "../ink/types";
import type { AliceSnapshot, BounceArc, WalkIntent } from "../sim/types";

export interface SceneInk {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly nature: Nature;
  readonly strength: number;
}

/** What Alice can see: the room as drawn, the ink as it lies now, and herself. */
export interface Scene {
  readonly level: LevelDefinition;
  readonly alice: AliceSnapshot;
  readonly inks: readonly SceneInk[];
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
  /** Walking speed in px per tick at her current size, so the planner can model flight. */
  readonly walkSpeed: number;
  /** The arc a bounce of the given strength throws her on under the current gravity. */
  readonly bounceArc: (strength: number) => BounceArc;
}

export type Objective = "key" | "door" | "exit";

export type Errand =
  /** A path to the objective exists; she is on it. */
  | { readonly kind: "objective"; readonly objective: Objective }
  /** Something edible (grow/shrink) is reachable and the objective is not; go and touch it. */
  | { readonly kind: "eat"; readonly drawingId: Drawing["id"] }
  /** Nothing helps yet: walk as close to the objective as the page allows, then wait. */
  | { readonly kind: "wait"; readonly objective: Objective };

export interface PilotStatus {
  readonly errand: Errand;
  /** True while she has arrived at the end of what is possible and is looking at the player. */
  readonly stuck: boolean;
  readonly target: Vec | null;
}

/**
 * Alice's own mind. Deterministic, offline, and re-planned every few ticks: the player draws,
 * Alice finds the way. It never jumps — it only walks, climbs, falls and rides what is there.
 */
export interface Autopilot {
  /** Forget the plan; called on room entry and reset. */
  reset(): void;
  /** Force the next `drive` to re-plan, e.g. when ink was added, named or erased. */
  invalidate(): void;
  /** One call per simulation step. */
  drive(scene: Scene): WalkIntent;
  readonly status: PilotStatus;
}
