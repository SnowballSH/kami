import Matter from "matter-js";
import type { Vec } from "../core/geometry";
import { DEFAULT_PHYSICS, gravityVector, type PhysicsState } from "../core/physics";
import { FIXED_STEP_MS } from "../core/world";
import { ALICE_AIR_FRICTION, GRAVITY_SCALE, SOLID_FRICTION } from "./constants";
import type { InkMaterial } from "./inkBody";
import type { BounceArc } from "./types";

/** The writable laws of the page, and how they land on matter-js bodies. */
export class Laws {
  private state: PhysicsState = DEFAULT_PHYSICS;
  private gravity: Vec = gravityVector(DEFAULT_PHYSICS.gravity);

  get current(): PhysicsState {
    return this.state;
  }

  /** Acceleration every dynamic body feels from gravity, in px per tick² per unit mass. */
  get gravityPerMass(): Vec {
    return { x: this.gravity.x * GRAVITY_SCALE, y: this.gravity.y * GRAVITY_SCALE };
  }

  /** The arc Alice flies when launched straight up at `speed` px per tick, tick by tick as the engine will integrate it. */
  arcOf(speed: number): BounceArc {
    const { x, y } = this.gravityPerMass;
    const pull = Math.hypot(x, y) * FIXED_STEP_MS * FIXED_STEP_MS;
    const drag = ALICE_AIR_FRICTION * this.state.airDrag;
    return traceArc(speed, pull, drag);
  }

  get windPerMass(): Vec {
    const { wind } = this.state;
    return { x: wind.x * GRAVITY_SCALE, y: wind.y * GRAVITY_SCALE };
  }

  get hasWind(): boolean {
    const { wind } = this.state;
    return wind.x !== 0 || wind.y !== 0;
  }

  set(patch: Partial<PhysicsState>): void {
    this.state = { ...this.state, ...patch };
    this.gravity = gravityVector(this.state.gravity);
  }

  reset(): void {
    this.set(DEFAULT_PHYSICS);
  }

  applyTo(engine: Matter.Engine, bulletTimeScale: number): void {
    engine.gravity.x = this.gravity.x;
    engine.gravity.y = this.gravity.y;
    engine.gravity.scale = GRAVITY_SCALE;
    engine.timing.timeScale = bulletTimeScale * this.state.timeScale;
  }

  blow(bodies: readonly Matter.Body[]): void {
    if (!this.hasWind) return;
    const wind = this.windPerMass;
    for (const body of bodies) {
      if (body.isStatic) continue;
      Matter.Body.applyForce(body, body.position, {
        x: body.mass * wind.x,
        y: body.mass * wind.y,
      });
    }
  }

  inkMaterial(base: InkMaterial): InkMaterial {
    const { frictionScale, airDrag, bounciness } = this.state;
    return {
      density: base.density,
      friction: base.friction * frictionScale,
      frictionAir: base.frictionAir * airDrag,
      restitution: bounciness,
    };
  }

  dressInk(body: Matter.Body, base: InkMaterial): void {
    const material = this.inkMaterial(base);
    body.friction = material.friction;
    body.frictionAir = material.frictionAir;
    body.restitution = material.restitution;
  }

  dressAlice(body: Matter.Body): void {
    body.frictionAir = ALICE_AIR_FRICTION * this.state.airDrag;
    body.restitution = this.state.bounciness;
  }

  dressSolid(body: Matter.Body): void {
    body.friction = SOLID_FRICTION * this.state.frictionScale;
  }
}

const ARC_TICK_LIMIT = 100_000;

const traceArc = (speed: number, pull: number, drag: number): BounceArc => {
  const heights: number[] = [0];
  let velocity = -speed;
  let height = 0;
  let apexPx = 0;
  let ticksToApex = 0;
  while (heights.length < ARC_TICK_LIMIT) {
    velocity = velocity * (1 - drag) + pull;
    height -= velocity;
    if (height <= 0) break;
    heights.push(height);
    if (height > apexPx) {
      apexPx = height;
      ticksToApex = heights.length - 1;
    }
  }
  const unbounded = heights.length >= ARC_TICK_LIMIT;
  return {
    apexPx: unbounded ? Number.POSITIVE_INFINITY : apexPx,
    ticksToApex: unbounded ? Number.POSITIVE_INFINITY : ticksToApex,
    ticksAloftAbove: (risePx) => {
      if (risePx > apexPx) return null;
      for (let tick = heights.length - 1; tick >= 0; tick--) {
        if ((heights[tick] ?? 0) >= risePx) return tick;
      }
      return null;
    },
  };
};
