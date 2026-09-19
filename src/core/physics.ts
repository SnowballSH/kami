import type { Vec } from "./geometry";

/** Metres are only for talking to people: the page is 1024 px ≈ 8 m wide. */
export const PIXELS_PER_METRE = 128;
export const EARTH_G_MPS2 = 9.81;

/** Angles are degrees, clockwise from +x in screen space, so 90° points down. */
export const DOWN_DEG = 90;

/**
 * Everything about the world's physics that words may change. Every field is a plain multiplier
 * or vector so a model can read, reason about, and rewrite it without knowing matter-js.
 */
export interface PhysicsState {
  /** In multiples of Earth's g; 1 is the page as drawn. */
  readonly gravity: { readonly magnitudeG: number; readonly angleDeg: number };
  /** World speed; 1 is real time. Bullet-time while drawing multiplies on top of this. */
  readonly timeScale: number;
  /** A constant push on everything that can move, in multiples of g. */
  readonly wind: Vec;
  /** Scales every body's air friction. 0 is a vacuum. */
  readonly airDrag: number;
  /** Restitution shared by Alice and all ink. 0 is dead paper, 1 is a rubber ball. */
  readonly bounciness: number;
  /** Scales surface friction of ink and level solids. */
  readonly frictionScale: number;
  /** Scales Alice's walking and climbing speed. */
  readonly walkSpeedFactor: number;
}

export const DEFAULT_PHYSICS: PhysicsState = {
  gravity: { magnitudeG: 1, angleDeg: DOWN_DEG },
  timeScale: 1,
  wind: { x: 0, y: 0 },
  airDrag: 1,
  bounciness: 0,
  frictionScale: 1,
  walkSpeedFactor: 1,
};

export const gravityVector = (gravity: PhysicsState["gravity"]): Vec => {
  const radians = (gravity.angleDeg * Math.PI) / 180;
  return {
    x: gravity.magnitudeG * Math.cos(radians),
    y: gravity.magnitudeG * Math.sin(radians),
  };
};
