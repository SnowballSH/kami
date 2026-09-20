import Matter from "matter-js";
import { clamp, type Rect, type Stroke, type Vec } from "../core/geometry";
import { inEffectDomain } from "../rules/effectDomains";
import type { WorldPhysics } from "../rules/types";
import {
  abilitiesOf,
  type BodySpace,
  EVERY_ABILITY,
  graft,
  namesWings,
  snip,
  toBodySpace,
  toWorldSpace,
} from "./body/drawnBody";
import type { Abilities, BodyFrame, Cut, DrawnBody, Grafted, Snipped } from "./body/types";
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
  type AliceLook,
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

  /** How much bigger than Kami's Alice she was drawn; 1 for Alice herself. */
  private readonly innate: number;
  private form: DrawnBody | null = null;
  private name = "";
  private clock = 0;
  private currentSize: AliceSize = "normal";
  private currentScale: number;
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
    frame: BodyFrame = ALICE_BASE,
  ) {
    this.innate = frame.height / ALICE_BASE.height;
    this.currentScale = this.innate;
    this.body = Matter.Bodies.rectangle(
      feet.x,
      feet.y - frame.height / 2,
      frame.width,
      frame.height,
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
    return this.physics.flight > 0 || this.abilities.fly;
  }

  get abilities(): Abilities {
    return this.form === null ? EVERY_ABILITY : abilitiesOf(this.form);
  }

  get drawnBody(): DrawnBody | null {
    return this.form;
  }

  /** Where her heart is, in the world: the soul's seat in a drawn body, her middle otherwise. */
  heart(): Vec {
    const { x, y } = this.body.position;
    return this.form === null ? { x, y } : toWorldSpace(this.form.heart, this.bodySpace());
  }

  bodySpace(): BodySpace {
    const { x, y } = this.body.position;
    return { centre: { x, y }, facing: this.facing, scale: this.currentScale / this.innate };
  }

  /** The strokes a player drew become her; she is `name` from now on. */
  wear(body: DrawnBody, name: string): void {
    this.form = body;
    this.name = name;
  }

  /** The blades close along `cut` (in the world); null unless she wears a drawn body. */
  snip(cut: Cut): Snipped | null {
    if (this.form === null) return null;
    const space = this.bodySpace();
    const result = snip(this.form, {
      from: toBodySpace(cut.from, space),
      to: toBodySpace(cut.to, space),
    });
    this.form = result.body;
    return result;
  }

  /** Strokes drawn in the world join her body where they touch it; null if they missed or she has none. */
  graft(worldStrokes: readonly Stroke[]): Grafted | null {
    if (this.form === null) return null;
    const space = this.bodySpace();
    const local = worldStrokes.map((stroke) => stroke.map((point) => toBodySpace(point, space)));
    const result = graft(this.form, local, this.clock, namesWings(this.name));
    if (result !== null) this.form = result.body;
    return result;
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
    return this.innate * ALICE_SCALE[this.currentSize] * this.physics.aliceSize;
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

  control(wanted: WalkIntent, surroundings: AliceSurroundings, timeScale: number): void {
    const can = this.abilities;
    const intent: WalkIntent = {
      x: can.walk ? wanted.x : 0,
      y: can.jump || can.climb || this.flying ? wanted.y : 0,
    };
    if (intent.x !== 0) this.facing = intent.x;
    this.walking = intent.x !== 0;
    this.climbing =
      this.flying || (can.climb && this.onClimbable && (!this.grounded || intent.y < 0));

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
    if (!this.jumpArmed || !this.grounded || this.onClimbable || !this.abilities.jump) return false;
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
    this.resize = { from: this.currentScale, to: this.lawfulScale, elapsedMs: 0 };
  }

  advanceResize(elapsedMs: number): void {
    this.clock += elapsedMs;
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
      look: this.look(),
    };
  }

  private look(): AliceLook {
    if (this.form === null) return { kind: "alice" };
    return {
      kind: "drawn",
      body: this.form,
      scale: this.currentScale / this.innate,
      abilities: this.abilities,
      clockMs: this.clock,
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
