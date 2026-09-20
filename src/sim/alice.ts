import Matter from "matter-js";
import { clamp, type Rect, type Vec } from "../core/geometry";
import { inEffectDomain } from "../rules/effectDomains";
import type { WorldPhysics } from "../rules/types";
import { bottomOf, exactBounds } from "./bodyBounds";
import {
  ALICE_AIR_FRICTION,
  ALICE_CHAMFER_RADIUS,
  BLOCKED_TICKS_BEFORE_STEP,
  CLIMB_SPEED,
  INK_STEP_RATIO,
  PROBE_AHEAD,
  PROBE_BELOW,
  RESIZE_MS,
  SLIDE_ACCELERATION,
  SOLID_STEP,
  STEP_FORWARD,
  STEP_INCREMENT,
} from "./constants";
import {
  ALICE_GROUP,
  blocks,
  CATEGORY,
  type Contact,
  contactsAt,
  contactsWith,
  isFreeAt,
  supports,
} from "./contacts";
import { jumpSpeedAt, walkSpeedAt } from "./flight";
import {
  ALICE_BASE,
  ALICE_SCALE,
  type AliceSize,
  type AliceSnapshot,
  type Axis,
  type WalkIntent,
} from "./types";
import { accelerationOf, airFrictionUnder, cancelGravity } from "./worldPhysics";

/** Everything around Alice that her controller needs to feel its way. */
export interface AliceSurroundings {
  readonly obstacles: readonly Matter.Body[];
  /** Ink she walks through: ladders, goals, spawn marks. */
  readonly passables: readonly Matter.Body[];
  isInk(body: Matter.Body): boolean;
  isSlippery(body: Matter.Body): boolean;
  isClimbable(body: Matter.Body): boolean;
  /** A vehicle under her that flies where she points, so up is not a jump. */
  liftsHer(body: Matter.Body): boolean;
}

interface ResizeTween {
  readonly from: number;
  readonly to: number;
  elapsedMs: number;
}

const approach = (value: number, target: number, maxChange: number): number =>
  value + clamp(target - value, -maxChange, maxChange);

const holdBack = (velocityX: number, direction: Axis): number =>
  direction > 0 ? Math.min(velocityX, 0) : Math.max(velocityX, 0);

export class AliceController {
  readonly body: Matter.Body;
  hasKey = false;

  private currentSize: AliceSize = "normal";
  private currentScale = ALICE_SCALE.normal;
  private resize: ResizeTween | null = null;
  private facing: -1 | 1 = 1;
  private walking = false;
  private climbing = false;
  private onClimbable = false;
  private piloting = false;
  private footing: readonly Contact[] = [];
  private ahead: readonly Contact[] = [];
  private passing: readonly Contact[] = [];
  private blockedTicks = 0;
  private jumpArmed = true;
  private lastFootingY: number;

  constructor(
    feet: Vec,
    private physics: WorldPhysics,
  ) {
    this.body = Matter.Bodies.rectangle(
      feet.x,
      feet.y - ALICE_BASE.height / 2,
      ALICE_BASE.width,
      ALICE_BASE.height,
      {
        chamfer: { radius: ALICE_CHAMFER_RADIUS },
        friction: 0,
        frictionStatic: 0,
        collisionFilter: { category: CATEGORY.alice, group: ALICE_GROUP },
      },
    );
    Matter.Body.setInertia(this.body, Number.POSITIVE_INFINITY);
    this.lastFootingY = feet.y;
    this.applyPhysics(physics);
  }

  get size(): AliceSize {
    return this.currentSize;
  }

  get scale(): number {
    return this.currentScale;
  }

  get velocity(): Vec {
    return Matter.Body.getVelocity(this.body);
  }

  get grounded(): boolean {
    return this.footing.length > 0;
  }

  get flying(): boolean {
    return this.physics.flight > 0;
  }

  get contacts(): readonly Contact[] {
    return [...this.footing, ...this.ahead, ...this.passing];
  }

  applyPhysics(physics: WorldPhysics): void {
    if (!inEffectDomain("aliceSize", physics.aliceSize)) throw new RangeError("Invalid Alice size");
    this.physics = physics;
    this.body.frictionAir = airFrictionUnder(physics, ALICE_AIR_FRICTION);
    this.body.restitution = physics.bounciness;
  }

  /** The scale the standing laws ask for; the sim grants growth only once there is headroom. */
  get lawfulScale(): number {
    return ALICE_SCALE[this.currentSize] * this.physics.aliceSize;
  }

  get headingScale(): number {
    return this.resize?.to ?? this.currentScale;
  }

  bounds(): Rect {
    return exactBounds(this.body);
  }

  /** The point between her soles: where the ground under her is. */
  feet(): Vec {
    const bounds = this.bounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
  }

  /** Where she stands, pulled onto the widest thing under her so she can be set down there again. */
  footingPoint(): Vec | null {
    const widest = this.footing
      .map((contact) => exactBounds(contact.body))
      .reduce<Rect | null>(
        (best, rest) => (best !== null && best.width >= rest.width ? best : rest),
        null,
      );
    if (widest === null) return null;
    const feet = this.feet();
    const halfWidth = this.bounds().width / 2;
    const left = widest.x + halfWidth;
    const right = widest.x + widest.width - halfWidth;
    return {
      x: left > right ? widest.x + widest.width / 2 : clamp(feet.x, left, right),
      y: feet.y,
    };
  }

  standsOn(body: Matter.Body): boolean {
    return this.footing.some((contact) => contact.body === body);
  }

  sense(surroundings: AliceSurroundings, intent: WalkIntent): void {
    const { obstacles, passables } = surroundings;
    this.footing = contactsAt(this.body, { x: 0, y: PROBE_BELOW }, obstacles).filter(supports);
    this.ahead =
      intent.x === 0 ? [] : contactsAt(this.body, { x: intent.x * PROBE_AHEAD, y: 0 }, obstacles);
    this.passing = contactsWith(this.body, passables);
    this.onClimbable = this.passing.some((contact) => surroundings.isClimbable(contact.body));
    this.piloting = this.footing.some((contact) => surroundings.liftsHer(contact.body));
    if (this.grounded) this.lastFootingY = bottomOf(this.bounds());
  }

  control(intent: WalkIntent, surroundings: AliceSurroundings, timeScale: number): void {
    if (intent.x !== 0) this.facing = intent.x;
    this.walking = intent.x !== 0;
    this.climbing = this.flying || (this.onClimbable && (!this.grounded || intent.y < 0));

    const velocity = this.velocity;
    const stepped = this.updateBlocking(intent.x, surroundings, timeScale);
    const blocked = this.blockedTicks > 0;
    const velocityX = blocked
      ? holdBack(velocity.x, intent.x)
      : this.walkVelocity(velocity.x, intent.x, surroundings);

    if (this.climbing) cancelGravity(this.body, accelerationOf(this.physics.gravity));
    if (this.piloting) this.jumpArmed = false;
    const velocityY = this.climbing
      ? intent.y * CLIMB_SPEED
      : this.piloting
        ? velocity.y
        : this.takeOff(intent)
          ? -jumpSpeedAt(this.currentScale)
          : stepped
            ? 0
            : velocity.y;
    Matter.Body.setVelocity(this.body, { x: velocityX, y: velocityY });
  }

  /** Up, off the ground and away from anything climbable, is a jump; holding up does not hop again. */
  private takeOff(intent: WalkIntent): boolean {
    if (intent.y >= 0) {
      this.jumpArmed = true;
      return false;
    }
    if (!this.jumpArmed || !this.grounded || this.onClimbable) return false;
    this.jumpArmed = false;
    this.footing = [];
    return true;
  }

  launch(speed: number): void {
    Matter.Body.setVelocity(this.body, { x: this.velocity.x, y: -speed });
  }

  ride(platformVelocity: Vec): void {
    const velocity = this.velocity;
    Matter.Body.setVelocity(this.body, {
      x: velocity.x + platformVelocity.x,
      y: Math.min(velocity.y, platformVelocity.y),
    });
  }

  /** Aboard something she steers: it moves, and she goes exactly with it. */
  drive(vehicleVelocity: Vec): void {
    Matter.Body.setVelocity(this.body, {
      x: vehicleVelocity.x,
      y: Math.min(this.velocity.y, vehicleVelocity.y),
    });
  }

  placeAt(feet: Vec): void {
    const { height } = this.bounds();
    Matter.Body.setPosition(this.body, { x: feet.x, y: feet.y - height / 2 });
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    this.footing = [];
    this.ahead = [];
    this.passing = [];
    this.onClimbable = false;
    this.piloting = false;
    this.blockedTicks = 0;
    this.jumpArmed = true;
    this.lastFootingY = feet.y;
  }

  /** Sets her down with her middle at `centre`, keeping the speed she arrived with. */
  warpTo(centre: Vec): void {
    const velocity = this.velocity;
    const { height } = this.bounds();
    this.placeAt({ x: centre.x, y: centre.y + height / 2 });
    Matter.Body.setVelocity(this.body, velocity);
  }

  beginResize(size: AliceSize): void {
    this.currentSize = size;
    const to = ALICE_SCALE[size] * this.physics.aliceSize;
    this.resize = { from: this.currentScale, to, elapsedMs: 0 };
  }

  advanceResize(elapsedMs: number): void {
    const tween = this.resize;
    if (tween === null) return;
    tween.elapsedMs += elapsedMs;
    const progress = clamp(tween.elapsedMs / RESIZE_MS, 0, 1);
    this.rescale(tween.from + (tween.to - tween.from) * progress);
    if (progress === 1) this.resize = null;
  }

  snapshot(): AliceSnapshot {
    const { width, height } = this.bounds();
    const { x, y } = this.body.position;
    return {
      center: { x, y },
      width,
      height,
      size: this.currentSize,
      sizeMultiplier: this.physics.aliceSize,
      headingScale: this.headingScale,
      facing: this.facing,
      walking: this.walking,
      grounded: this.grounded,
      climbing: this.climbing,
      hasKey: this.hasKey,
    };
  }

  private walkVelocity(current: number, direction: Axis, surroundings: AliceSurroundings): number {
    if (direction === 0 && !this.grounded && !this.climbing) return current;
    const target = direction * walkSpeedAt(this.currentScale, this.physics.walkSpeed);
    const onSlipperyInk = this.footing.some((contact) => surroundings.isSlippery(contact.body));
    const traction = onSlipperyInk ? 0 : Math.max(this.physics.friction, 0);
    return traction >= 1 ? target : approach(current, target, SLIDE_ACCELERATION / (1 - traction));
  }

  private updateBlocking(
    direction: Axis,
    surroundings: AliceSurroundings,
    timeScale: number,
  ): boolean {
    const blockers = this.ahead.filter((contact) => blocks(contact, direction));
    if (direction === 0 || blockers.length === 0) {
      this.blockedTicks = 0;
      return false;
    }
    this.blockedTicks += timeScale;
    const patience = BLOCKED_TICKS_BEFORE_STEP[this.grounded ? "grounded" : "airborne"];
    if (this.blockedTicks < patience) return false;
    const stepped = this.stepOver(direction, blockers, surroundings);
    if (stepped) this.blockedTicks = 0;
    return stepped;
  }

  private stepOver(
    direction: Axis,
    blockers: readonly Contact[],
    surroundings: AliceSurroundings,
  ): boolean {
    const bounds = this.bounds();
    const feetY = bottomOf(bounds);
    const onlyInk = blockers.every((contact) => surroundings.isInk(contact.body));
    const maxRise = onlyInk
      ? INK_STEP_RATIO * bounds.height
      : clamp(
          SOLID_STEP.ratio * bounds.height,
          SOLID_STEP.min,
          SOLID_STEP.maxRatio * bounds.height,
        );
    const riseFrom = onlyInk ? Math.max(this.lastFootingY, feetY) : feetY;

    for (let lift = STEP_INCREMENT; riseFrom - (feetY - lift) <= maxRise; lift += STEP_INCREMENT) {
      const offset = { x: direction * STEP_FORWARD, y: -lift };
      if (!isFreeAt(this.body, offset, surroundings.obstacles)) continue;
      Matter.Body.translate(this.body, offset);
      return true;
    }
    return false;
  }

  private rescale(nextScale: number): void {
    const factor = nextScale / this.currentScale;
    const velocity = this.velocity;
    const feet = { x: this.body.position.x, y: bottomOf(this.bounds()) };
    Matter.Body.scale(this.body, factor, factor, feet);
    Matter.Body.setInertia(this.body, Number.POSITIVE_INFINITY);
    Matter.Body.setVelocity(this.body, velocity);
    this.currentScale = nextScale;
  }
}
