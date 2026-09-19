import type { Nature } from "../cat/types";
import type { Rect, Vec } from "../core/geometry";
import { DEFAULT_PHYSICS, type PhysicsState, PIXELS_PER_METRE } from "../core/physics";
import { WORLD } from "../core/world";
import type { DrawingId } from "../ink/types";
import type { AliceSize } from "../sim/types";

export type { PhysicsState } from "../core/physics";
export { DEFAULT_PHYSICS, DOWN_DEG, EARTH_G_MPS2, PIXELS_PER_METRE } from "../core/physics";

export interface DrawingFact {
  readonly id: DrawingId;
  /** What the player called it, or null while it is still plain, unnamed ink. */
  readonly name: string | null;
  readonly nature: Nature;
  readonly strength: number;
  /** World-space bounding box of the ink right now. */
  readonly bounds: Rect;
  readonly isStatic: boolean;
}

export interface AliceFact {
  /** Centre of her body, world px. */
  readonly position: Vec;
  readonly width: number;
  readonly height: number;
  readonly size: AliceSize;
  readonly facing: -1 | 1;
  readonly grounded: boolean;
  readonly climbing: boolean;
  readonly hasKey: boolean;
}

export interface RoomFact {
  readonly id: string;
  readonly title: string;
  readonly pageNumber: number;
  readonly pageCount: number;
  readonly allowedNatures: readonly Nature[];
  readonly ink: { readonly total: number; readonly remaining: number };
  readonly spawn: Vec;
  readonly exit: Rect;
  readonly key: Vec | null;
  readonly keyTaken: boolean;
  readonly door: Rect | null;
  readonly doorOpen: boolean;
  readonly solids: readonly Rect[];
}

/** A read-only snapshot of everything a model may want to know before it speaks. */
export interface WorldFacts {
  readonly page: {
    readonly width: number;
    readonly height: number;
    readonly pixelsPerMetre: number;
  };
  readonly room: RoomFact;
  readonly physics: PhysicsState;
  readonly alice: AliceFact;
  readonly drawings: readonly DrawingFact[];
}

/** An empty page: what a Cat is told before any room has been entered. */
export const NO_FACTS: WorldFacts = {
  page: { width: WORLD.width, height: WORLD.height, pixelsPerMetre: PIXELS_PER_METRE },
  room: {
    id: "nowhere",
    title: "",
    pageNumber: 0,
    pageCount: 0,
    allowedNatures: [],
    ink: { total: 0, remaining: 0 },
    spawn: { x: 0, y: 0 },
    exit: { x: 0, y: 0, width: 0, height: 0 },
    key: null,
    keyTaken: false,
    door: null,
    doorOpen: false,
    solids: [],
  },
  physics: DEFAULT_PHYSICS,
  alice: {
    position: { x: 0, y: 0 },
    width: 0,
    height: 0,
    size: "normal",
    facing: 1,
    grounded: false,
    climbing: false,
    hasKey: false,
  },
  drawings: [],
};

export const SPAWN_SHAPES = ["line", "box", "circle", "blob"] as const;
export type SpawnShape = (typeof SPAWN_SHAPES)[number];

/**
 * One change to the world. The union is the whole writable surface: anything not expressible
 * here cannot be changed by words. Numbers are validated for finiteness only — the sandbox is
 * unbounded on purpose.
 */
export type WorldEdit =
  | { readonly op: "set_gravity"; readonly magnitudeG?: number; readonly angleDeg?: number }
  | { readonly op: "set_time_scale"; readonly factor: number }
  | { readonly op: "set_wind"; readonly x: number; readonly y: number }
  | { readonly op: "set_air_drag"; readonly factor: number }
  | { readonly op: "set_bounciness"; readonly restitution: number }
  | { readonly op: "set_friction"; readonly factor: number }
  | { readonly op: "set_walk_speed"; readonly factor: number }
  | { readonly op: "resize_alice"; readonly size: AliceSize }
  | {
      readonly op: "set_nature";
      readonly drawingId: DrawingId;
      readonly nature: Nature;
      readonly strength?: number;
      readonly name?: string;
    }
  | { readonly op: "remove_drawing"; readonly drawingId: DrawingId }
  | {
      readonly op: "spawn_drawing";
      readonly shape: SpawnShape;
      /** Centre, world px. */
      readonly at: Vec;
      readonly width: number;
      readonly height: number;
      readonly name: string;
      readonly nature: Nature;
      readonly strength?: number;
    }
  | { readonly op: "set_ink"; readonly remaining?: number; readonly total?: number }
  | { readonly op: "reset_physics" };

export type WorldEditOp = WorldEdit["op"];

/** What the world did with a batch of edits, so the Cat can be honest about it. */
export interface EditOutcome {
  readonly edit: WorldEdit;
  readonly applied: boolean;
  readonly reason?: string;
}
