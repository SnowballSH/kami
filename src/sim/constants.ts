import { INK_THICKNESS } from "../core/world";
import { KEY_PICKUP } from "./types";

export const GRAVITY_SCALE = 0.001;
export const MIN_TIME_SCALE = 0.01;
export const MAX_AIR_FRICTION = 0.5;

export const SOLID_FRICTION = 0.8;

export const INK_DENSITY = 0.004;
export const INK_FRICTION = 0.8;
export const INK_AIR_FRICTION = 0.01;
export const INK_DOT_RADIUS = INK_THICKNESS / 2;
export const MIN_SEGMENT_LENGTH = 1;
export const SIMPLIFY_TOLERANCE = 1.5;

export const ANCHOR_REACH = 16;
export const ANCHOR_CLUSTER_SPACING = 40;
export const ANCHOR_SAMPLE_SPACING = 8;

export const ALICE_CHAMFER_RADIUS = 13;
export const ALICE_AIR_FRICTION = 0.02;
export const WALK_SPEED = 2.2;
export const CLIMB_SPEED = 2;
export const JUMP_SPEED = 8.5;
export const SLIDE_ACCELERATION = 0.04;
export const MAX_WALKABLE_SLOPE_DEG = 50;
export const PROBE_AHEAD = 1.5;
export const PROBE_BELOW = 2;
export const BLOCKED_TICKS_BEFORE_STEP = { grounded: 3, airborne: 1 } as const;
export const STEP_FORWARD = 3;
export const STEP_INCREMENT = 2;
export const SOLID_STEP = { ratio: 0.3, min: 12, maxRatio: 0.5 } as const;
export const INK_STEP_RATIO = 0.8;
export const RESIZE_MS = 400;
export const REACH_RATIO = KEY_PICKUP.reachRatio;

export const KEY_RADIUS = KEY_PICKUP.radius;

export const BOUNCE_SPEED = 16.5;
export const BOUNCE_MAX_RISING_SPEED = 1;
export const FLOAT_SPEED = 1.1;
export const FLOAT_SPIN_DAMPING = 0.5;
export const FLOAT_DRIFT_DAMPING = 0.9;
export const HEAVY_DENSITY_FACTOR = 12;
export const LIGHT_DENSITY_FACTOR = 0.08;
export const LIGHT_AIR_FRICTION = 0.08;
export const GROW_REFUSAL_COOLDOWN_MS = 1500;
