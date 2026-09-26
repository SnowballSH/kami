import type { BoardDefinition } from "../board/types";
import type { Nature, Ruling } from "../cat/types";
import type { Pose, Rect, Stroke, Vec } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { WorldPhysics } from "../rules/types";
import type { Abilities, BodyPartKind, DrawnBody } from "./body/types";
import type { TearSnapshot } from "./boss/tear";
import type { SnipperRank } from "./boss/tuning";

export type AliceSize = "small" | "normal" | "big";

export const ALICE_SCALE: Readonly<Record<AliceSize, number>> = { small: 0.5, normal: 1, big: 2 };

export const ALICE_BASE = { width: 28, height: 60 } as const;

/** The scale an Alice drawn `innate` times Kami's Alice's height takes at `size` under a size law of `multiplier`. */
export const aliceScaleFor = (innate: number, size: AliceSize, multiplier: number): number =>
  innate * ALICE_SCALE[size] * multiplier;

/** She takes the key when it lies within `radius` of her body grown by `reachRatio` of her height. */
export const KEY_PICKUP = { reachRatio: 0.5, radius: 18 } as const;

/** Which Alice an event or intent is about: 0 is Alice herself, n ≥ 1 her n-th twin. */
export type AliceIndex = number;

export const ALICE_HERSELF: AliceIndex = 0;

export type Axis = -1 | 0 | 1;

/** `y` is only used while she overlaps something climbable: -1 is up. */
export interface WalkIntent {
  readonly x: Axis;
  readonly y: Axis;
}

/** How what she stands on moves, so the picture of her riding it can move the same way. */
export type Gait = "vehicle" | "walker" | "hopper" | "flier";

/** The drawing she is riding: a vehicle she drives or a creature carrying her. */
export interface Ride {
  readonly id: DrawingId;
  readonly gait: Gait;
}

export interface AliceSnapshot {
  readonly center: Vec;
  /** Px per tick; positive y is down. */
  readonly velocity: Vec;
  /** Current body size, mid-tween while she is growing or shrinking. */
  readonly width: number;
  readonly height: number;
  readonly size: AliceSize;
  readonly sizeMultiplier: number;
  /** How much bigger than Kami's Alice she was drawn; 1 for Alice herself. */
  readonly innateScale: number;
  /** Her scale now, mid-tween while resizing; `width` and `height` are her body at this scale. */
  readonly scale: number;
  /** The scale she is resizing towards, or `scale` when she is not. */
  readonly headingScale: number;
  readonly facing: -1 | 1;
  readonly walking: boolean;
  readonly grounded: boolean;
  readonly climbing: boolean;
  readonly hasKey: boolean;
  readonly ride: Ride | null;
  readonly look: AliceLook;
}

/**
 * How she is to be painted: the Alice Kami sketches, or the body a player drew for her, whose
 * strokes are in body space (`scale` and `facing` set them in the world) and each stroke's age
 * says how recently it was drawn onto her.
 */
export type AliceLook =
  | { readonly kind: "alice" }
  | {
      readonly kind: "drawn";
      readonly body: DrawnBody;
      readonly scale: number;
      readonly abilities: Abilities;
      readonly clockMs: number;
    };

/** The heart with no body around it yet, hovering where a body may be drawn. */
export interface SoulSnapshot {
  readonly at: Vec;
}

export type SumikuiPhase = "stirring" | "prowling" | "hunting" | "feeding" | "sated";

/** What it is after: a drawing, the board's own paper under her feet, or Alice herself. */
export type SumikuiQuarry = "ink" | "paper" | "alice";

export interface SumikuiSnapshot {
  readonly centre: Vec;
  readonly facing: -1 | 1;
  readonly phase: SumikuiPhase;
  readonly quarry: SumikuiQuarry | null;
  /** The Alice it is closing on, or whose ground it is biting, while `quarry` is `"alice"` or `"paper"`. */
  readonly prey: AliceIndex | null;
  /** The drawing between its teeth right now, dissolving as `bite` climbs. */
  readonly chewing: DrawingId | null;
  /** How far through its meal it is, 0 to 1; 0 unless feeding. */
  readonly bite: number;
  readonly awakeMs: number;
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
  /** Null while the player is a soul with no body drawn yet. */
  readonly alice: AliceSnapshot | null;
  readonly soul: SoulSnapshot | null;
  /** The rip the servant came through, while the fight is on. */
  readonly tear: TearSnapshot | null;
  /** Her copies, when a law has cloned her; each walks on her own intent. */
  readonly twins: readonly AliceSnapshot[];
  /** The ink eater, while the law that loosed it stands. */
  readonly sumikui: SumikuiSnapshot | null;
  /** Live drawings only; consumed and removed ones are gone. */
  readonly drawings: readonly DrawingPose[];
  /** Holes the Sumikui has bitten out of the board's solids and that have not healed yet. */
  readonly bites: readonly Rect[];
  readonly keyTaken: boolean;
  readonly doorOpen: boolean;
}

export type SimEvent =
  | { readonly type: "goal-reached"; readonly who: AliceIndex }
  | { readonly type: "fell"; readonly who: AliceIndex }
  | { readonly type: "zone-entered"; readonly zoneId: string }
  | { readonly type: "key-taken" }
  | { readonly type: "door-opened" }
  | { readonly type: "bounced"; readonly drawingId: DrawingId }
  | { readonly type: "consumed"; readonly drawingId: DrawingId; readonly nature: Nature }
  | { readonly type: "perished"; readonly drawingId: DrawingId; readonly nature: Nature }
  | { readonly type: "grow-blocked"; readonly drawingId: DrawingId }
  | { readonly type: "sumikui-woke" }
  | { readonly type: "devoured"; readonly drawingId: DrawingId; readonly nature: Nature }
  /** It bit through the board's own paper; `hole` is gone from the solids until it heals. */
  | { readonly type: "paper-bitten"; readonly hole: Rect }
  | { readonly type: "paper-healed" }
  /** It caught an Alice; she is returned to her checkpoint (a `fell` follows in the same step). */
  | { readonly type: "alice-devoured"; readonly who: AliceIndex }
  /** An Alice stepped into one portal and out of another. */
  | {
      readonly type: "warped";
      readonly who: AliceIndex;
      readonly from: DrawingId;
      readonly to: DrawingId;
    }
  /** Alice stepped into the only portal on the board; it leads nowhere yet. */
  | { readonly type: "portal-lonely"; readonly drawingId: DrawingId }
  /** She meant to walk, but in pitch dark with no lantern near she will not take a step (once per board load). */
  | { readonly type: "in-the-dark" }
  /** The servant of the one under the page came through the tear. */
  | { readonly type: "servant-came" }
  | { readonly type: "servants-came"; readonly lessers: number }
  /** A snip crossed her; `lost` are the parts she can no longer use. */
  | {
      readonly type: "snipped";
      readonly part: BodyPartKind;
      readonly lost: readonly BodyPartKind[];
    }
  | { readonly type: "snip-missed" }
  /** A drawing stood in the cut's way and was snipped instead of her. */
  | { readonly type: "shielded"; readonly drawingId: DrawingId }
  | { readonly type: "servant-struck"; readonly rank: SnipperRank; readonly drawingId: DrawingId }
  | { readonly type: "servant-perished"; readonly rank: SnipperRank }
  | { readonly type: "tear-closed" }
  /** The heart was cut with nothing around it; the body is gone and only the soul remains. */
  | { readonly type: "heart-swallowed" }
  | { readonly type: "part-restored"; readonly parts: readonly BodyPartKind[] };

import type { InkProvenance } from "../ink/types";

export type { InkProvenance };

export interface Simulation {
  /** Discards the whole world and rebuilds it with Alice standing at `board.spawn`. */
  loadBoard(board: BoardDefinition): void;
  /** The standing rules of the board. Survives `loadBoard`; applies from the next step. */
  setPhysics(physics: WorldPhysics): void;
  /** Ink is solid the moment it commits — as plain ink, before anyone has named it. Scenery is not for eating. */
  addDrawing(drawing: Drawing, provenance?: InkProvenance): void;
  applyRuling(id: DrawingId, ruling: Ruling): void;
  removeDrawing(id: DrawingId): void;
  /** Takes her body away, leaving the soul where her heart was (or at the spawn). */
  disembody(): void;
  /** The drawing becomes her body around the soul; false if there is no such drawing. */
  incarnate(id: DrawingId, name: string, strokes?: readonly Stroke[]): boolean;
  /** Strokes drawn onto a drawn body join it; false if they missed her or she has no drawn body. */
  graft(strokes: readonly Stroke[]): boolean;
  /** Opens the tear above the heart; the servant comes through after a breath. */
  openTear(): void;
  /** Steers one Alice; the others keep whatever they were last told. */
  setWalkIntent(intent: WalkIntent, who?: AliceIndex): void;
  /** 1 is real time; bullet-time passes BULLET_TIME_SCALE. */
  setTimeScale(scale: number): void;
  /** Advances one fixed step (FIXED_STEP_MS) and reports what happened during it. */
  step(): readonly SimEvent[];
  snapshot(): WorldSnapshot;
  /** All of her: Alice herself first, then her twins in order; nobody while the player is a soul. */
  alices(): readonly AliceSnapshot[];
  /** Where she stands; the soul's small frame while there is no body. */
  aliceBounds(who?: AliceIndex): Rect;
  /** How far the paper is turned on screen, in degrees clockwise, under the tilt and spin laws. */
  paperAngle(): number;
  /** Her walking speed at her current size and under the standing pace law, px per tick. */
  walkSpeed(who?: AliceIndex): number;
  /** True while a flight law stands. */
  canFly(): boolean;
  /** Where a spring of `strength` would throw her under the standing physics. */
  bounceArc(strength: number): BounceArc;
  /** The flight a jump from standing throws her on, at her current size. */
  jumpArc(who?: AliceIndex): BounceArc;
}
