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

export const CREATURE_WALK_SPEED = 1.3;
export const CREATURE_LOOK_AHEAD = 10;
export const CREATURE_EDGE_DROP = 24;
export const CREATURE_TURN_COOLDOWN_TICKS = 20;
export const HOP_REST_TICKS = 40;
export const HOP_UP_SPEED = 6;
export const HOP_FORWARD_SPEED = 2.4;
/** Roughly how far one hop carries, so a hopper looks that far before leaping. */
export const HOP_REACH = 90;
export const FLY_SPEED = 1.5;
export const VEHICLE_SPEED = 4.5;
export const VEHICLE_ACCELERATION = 0.25;
export const FLY_BOB_SPEED = 0.7;
export const FLY_BOB_PERIOD_TICKS = 90;
export const FLY_ROAM_PX = 320;
/** A follower stops chasing once Alice is this close, sideways or as the crow flies. */
export const HEEL_PX = 70;
/** A follower on the wing keeps a perch this far above Alice's head. */
export const PERCH_ABOVE_PX = 60;
/** A fleer bolts while Alice is within this; farther off it forgets her and roams. */
export const FLEE_RADIUS_PX = 220;
export const FLEE_HASTE = 1.7;
/** How far a lantern's light reaches: what it lights at night, and how far she will walk from it in pitch dark. */
export const LANTERN_LIGHT_PX = 260;
/** Below this much daylight she cannot see her feet, and will not take a step outside a lantern's light. */
export const PITCH_DARK_BELOW = 0.05;
/** How often Kami remarks on a portal with no twin while Alice keeps stepping into it. */
export const PORTAL_LONELY_COOLDOWN_MS = 4000;

/** The Sumikui stirs once the board holds this many drawings. */
export const SUMIKUI_WAKES_AT_DRAWINGS = 2;
/** Where it hovers relative to Alice while it has no prey: behind her, above her head. */
export const SUMIKUI_HOVER = { x: 110, y: -80 } as const;
/** Pace in px per ms when it first wakes; it doubles every `SUMIKUI_DOUBLES_EVERY_MS` awake. */
export const SUMIKUI_BASE_SPEED = 0.02;
export const SUMIKUI_DOUBLES_EVERY_MS = 20_000;
export const SUMIKUI_MAX_SPEED = 0.6;
/** Ink Alice touched longer ago than this is no longer hers to lose: it will not hunt it. */
export const SUMIKUI_MEMORY_MS = 20_000;
export const SUMIKUI_NEAR_PX = 600;
export const SUMIKUI_REACH = 24;
/** How long it sits on a drawing before the drawing is gone. */
export const SUMIKUI_BITE_MS = 1500;
/** Within this of Alice it forgets every other meal and lunges at her. */
export const SUMIKUI_LUNGE_PX = 90;
/** Chasing her, it gives up once she has this much of a lead and snaps at what she left behind. */
export const SUMIKUI_LOSES_HER_PX = 220;
/** How long it must hold Alice before she is devoured. */
export const SUMIKUI_CATCH_MS = 700;
/** Gorged on Alice it drifts sluggish for this long, and its pace starts over from the base. */
export const SUMIKUI_SATED_MS = 8_000;
/** The mouthful it takes out of the board's own paper: a column this wide, clean through the slab. */
export const SUMIKUI_BITE_WIDTH = 48;
/** Paper counts as under her feet when its top lies within this far below them. */
export const SUMIKUI_BITE_DEPTH = 40;
/** Bitten paper knits itself back after this long. */
export const SUMIKUI_SCAR_HEALS_MS = 30_000;
/** It never bites the paper this close to where Kami sets her down: the spawn and checkpoints. */
export const SUMIKUI_HALLOWED_PX = 90;
/** Awake this long, it stops ignoring clutter she never used and sweeps it up in one gulp. */
export const SUMIKUI_SWEEPS_AFTER_MS = 45_000;
export const SUMIKUI_GULP_MS = 250;
