import type { BoardDefinition } from "../board/types";
import type { Nature } from "../cat/types";
import type { Pose, Rect, Vec } from "../core/geometry";
import type { Drawing } from "../ink/types";
import type { AliceSnapshot, BounceArc, SumikuiSnapshot, WalkIntent } from "../sim/types";
import type { Chart } from "./chart";

export interface SceneInk {
  readonly drawing: Drawing;
  readonly pose: Pose;
  readonly nature: Nature;
  readonly strength: number;
}

/**
 * What one Alice can see: the board as sketched, the ink as it lies now, herself, and the other
 * Alices on the page. The others are company, never obstacles: the chart leaves them out.
 */
export interface Scene {
  readonly board: BoardDefinition;
  readonly alice: AliceSnapshot;
  readonly others: readonly AliceSnapshot[];
  /** In the order they were drawn, oldest first. */
  readonly inks: readonly SceneInk[];
  /** Holes the Sumikui has bitten out of the board's solids: air where the sketch says ground. */
  readonly bites: readonly Rect[];
  /** The ink eater, if it is loose: where it is, what it hunts and what it is chewing. */
  readonly sumikui: SumikuiSnapshot | null;
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
  /** Walking speed in px per tick at her current size, so the planner can model flight. */
  readonly walkSpeed: number;
  /** True under a flight law: she may climb through open air as if it were a ladder. */
  readonly canFly: boolean;
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
  /** The Sumikui is on her: run for the nearest footing out of its reach, the errand can wait. */
  | { readonly kind: "flee" }
  /** Nothing to reach for and a mind of her own: stroll one way until the ground runs out, then back. */
  | { readonly kind: "wander"; readonly heading: -1 | 1 }
  /** An endless page: wander towards the newest ink, or to the edge of what is drawn. */
  | { readonly kind: "explore"; readonly toward: Vec }
  /** The board has nothing to reach for yet — no key, door or goal. */
  | { readonly kind: "idle" };

export interface PilotStatus {
  readonly errand: Errand;
  /** True once she has come to the end of what is possible and is looking at the player. */
  readonly stuck: boolean;
  readonly target: Vec | null;
}

/** How a pilot reads the board; shared between pilots so several Alices chart the page once. */
export type Charter = (scene: Scene) => Chart | null;

export interface PilotOptions {
  /** Tells clones apart deterministically: which way each one first wanders, for one. */
  readonly seed: number;
  /** Clones stroll when the board has nothing to reach for; Alice herself waits for the player. */
  readonly wanders: boolean;
  readonly charter: Charter;
}

/**
 * Alice's own mind. Deterministic, offline, and re-planned every few ticks: the player draws,
 * Alice finds the way. She walks, hops, climbs, falls and rides what is there — and flies only when a law says so.
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
