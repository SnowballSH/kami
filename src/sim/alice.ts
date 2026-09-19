import Matter from "matter-js";
import { clamp, type Rect, type Vec } from "../core/geometry";
import { bottomOf, cancelGravity, exactBounds } from "./bodyBounds";
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
  WALK_SPEED,
} from "./constants";
import {
  blocks,
  CATEGORY,
  type Contact,
  contactsAt,
  contactsWith,
  isFreeAt,
  supports,
} from "./contacts";
import type { Laws } from "./laws";
import {
  ALICE_BASE,
  ALICE_SCALE,
  type AliceSize,
  type AliceSnapshot,
  type Axis,
  type WalkIntent,
} from "./types";

/** Everything around Alice that her controller needs to feel its way. */
export interface AliceSurroundings {
  readonly obstacles: readonly Matter.Body[];
  readonly climbables: readonly Matter.Body[];
  isInk(body: Matter.Body): boolean;
  isSlippery(body: Matter.Body): boolean;
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
  private scale = ALICE_SCALE.normal;
  private resize: ResizeTween | null = null;
  private facing: -1 | 1 = 1;
  private walking = false;
  private climbing = false;
  private onClimbable = false;
  private footing: readonly Contact[] = [];
  private ahead: readonly Contact[] = [];
  private blockedTicks = 0;
  private lastFootingY: number;

  constructor(
    feet: Vec,
    private readonly laws: Laws,
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
        frictionAir: ALICE_AIR_FRICTION,
        collisionFilter: { category: CATEGORY.alice },
      },
    );
    Matter.Body.setInertia(this.body, Number.POSITIVE_INFINITY);
    laws.dressAlice(this.body);
    this.lastFootingY = feet.y;
  }

  get size(): AliceSize {
    return this.currentSize;
  }

  get velocity(): Vec {
    return Matter.Body.getVelocity(this.body);
  }

  get grounded(): boolean {
    return this.footing.length > 0;
  }

  get contacts(): readonly Contact[] {
    return [...this.footing, ...this.ahead];
  }

  bounds(): Rect {
    return exactBounds(this.body);
  }

  walkSpeed(): number {
    return WALK_SPEED * Math.sqrt(this.scale) * this.laws.current.walkSpeedFactor;
  }

  standsOn(body: Matter.Body): boolean {
    return this.footing.some((contact) => contact.body === body);
  }

  sense(surroundings: AliceSurroundings, intent: WalkIntent): void {
    const { obstacles, climbables } = surroundings;
    this.footing = contactsAt(this.body, { x: 0, y: PROBE_BELOW }, obstacles).filter(supports);
    this.ahead =
      intent.x === 0 ? [] : contactsAt(this.body, { x: intent.x * PROBE_AHEAD, y: 0 }, obstacles);
    this.onClimbable = contactsWith(this.body, climbables).length > 0;
    if (this.grounded) this.lastFootingY = bottomOf(this.bounds());
  }

  control(intent: WalkIntent, surroundings: AliceSurroundings, timeScale: number): void {
    if (intent.x !== 0) this.facing = intent.x;
    this.walking = intent.x !== 0;
    this.climbing = this.onClimbable && (!this.grounded || intent.y < 0);

    const velocity = this.velocity;
    const stepped = this.updateBlocking(intent.x, surroundings, timeScale);
    const blocked = this.blockedTicks > 0;
    const velocityX = blocked
      ? holdBack(velocity.x, intent.x)
      : this.walkVelocity(velocity.x, intent.x, surroundings);

    if (this.climbing) cancelGravity(this.body, this.laws.gravityPerMass);
    const climbSpeed = CLIMB_SPEED * this.laws.current.walkSpeedFactor;
    const velocityY = this.climbing
      ? intent.y * climbSpeed
      : stepped
        ? Math.min(0, velocity.y)
        : velocity.y;
    Matter.Body.setVelocity(this.body, { x: velocityX, y: velocityY });
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

  placeAt(feet: Vec): void {
    const { height } = this.bounds();
    Matter.Body.setPosition(this.body, { x: feet.x, y: feet.y - height / 2 });
    Matter.Body.setVelocity(this.body, { x: 0, y: 0 });
    this.footing = [];
    this.ahead = [];
    this.blockedTicks = 0;
    this.lastFootingY = feet.y;
  }

  beginResize(size: AliceSize): void {
    this.currentSize = size;
    this.resize = { from: this.scale, to: ALICE_SCALE[size], elapsedMs: 0 };
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
      facing: this.facing,
      walking: this.walking,
      grounded: this.grounded,
      climbing: this.climbing,
      hasKey: this.hasKey,
    };
  }

  private walkVelocity(current: number, direction: Axis, surroundings: AliceSurroundings): number {
    const target = direction * this.walkSpeed();
    const sliding = this.footing.some((contact) => surroundings.isSlippery(contact.body));
    return sliding ? approach(current, target, SLIDE_ACCELERATION) : target;
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
    const factor = nextScale / this.scale;
    const velocity = this.velocity;
    const feet = { x: this.body.position.x, y: bottomOf(this.bounds()) };
    Matter.Body.scale(this.body, factor, factor, feet);
    Matter.Body.setInertia(this.body, Number.POSITIVE_INFINITY);
    Matter.Body.setVelocity(this.body, velocity);
    this.scale = nextScale;
  }
}
