import { clamp, distance, type Vec } from "../../core/geometry";
import { aliveParts, partReach, toWorldSpace } from "../body/drawnBody";
import type { BodyPartKind, Cut, DrawnBody } from "../body/types";
import { SNIP_PRIORITY, SNIPPER_TUNING, type SnipperRank, TEAR_TUNING } from "./tuning";

/** The body it hunts, as it stands this tick. */
export interface Prey {
  readonly heart: Vec;
  readonly body: DrawnBody;
  readonly centre: Vec;
  readonly facing: -1 | 1;
  readonly scale: number;
}

export type SnipperPhase =
  | { readonly kind: "arriving" }
  | { readonly kind: "circling"; readonly untilMs: number }
  | {
      readonly kind: "winding";
      readonly cut: Cut;
      readonly part: BodyPartKind;
      readonly fromMs: number;
      readonly untilMs: number;
    }
  | {
      readonly kind: "lunging";
      readonly cut: Cut;
      readonly part: BodyPartKind;
      readonly fromMs: number;
      readonly untilMs: number;
    }
  | { readonly kind: "recovering"; readonly untilMs: number }
  | { readonly kind: "perishing"; readonly fromMs: number };

export type SnipperPhaseKind = SnipperPhase["kind"];

export type SnipperDeed =
  | { readonly kind: "cut"; readonly cut: Cut; readonly part: BodyPartKind }
  | { readonly kind: "perished" };

export interface SnipperSnapshot {
  readonly rank: SnipperRank;
  readonly position: Vec;
  readonly radius: number;
  readonly facing: -1 | 1;
  readonly phase: SnipperPhaseKind;
  /** How far through the phase it is, 0 to 1; 0 while arriving. */
  readonly progress: number;
  /** The line the blades will close along, from the moment it winds up until the snip lands. */
  readonly cut: Cut | null;
  readonly health: number;
  readonly hurtAgoMs: number | null;
}

const ARRIVED_PX = 24;
const CUT_ALONG_LIMB = 0.55;

const towards = (from: Vec, to: Vec, step: number): Vec => {
  const gap = distance(from, to);
  if (gap <= step) return to;
  const scale = step / gap;
  return { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale };
};

const lerp = (from: Vec, to: Vec, t: number): Vec => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

const partsWithInk = (body: DrawnBody): ReadonlySet<BodyPartKind> =>
  new Set(body.strokes.map((stroke) => stroke.part));

/** What it goes for: the limbs she runs on first, then the rest, the bare heart last. */
export const targetOf = (body: DrawnBody): BodyPartKind | null => {
  const alive = new Set(aliveParts(body));
  const inked = partsWithInk(body);
  return (
    SNIP_PRIORITY.find((part) => alive.has(part)) ??
    SNIP_PRIORITY.find((part) => inked.has(part)) ??
    null
  );
};

/** A cut across a part, halfway along it from the heart, fixed in the world the moment it is chosen. */
export const cutAcross = (prey: Prey, part: BodyPartKind | null, halfLength: number): Cut => {
  const space = { centre: prey.centre, facing: prey.facing, scale: prey.scale };
  const reach = part === null ? null : partReach(prey.body, part);
  const tip = reach === null ? prey.heart : toWorldSpace(reach.tip, space);
  const along = { x: tip.x - prey.heart.x, y: tip.y - prey.heart.y };
  const length = Math.hypot(along.x, along.y);
  const axis = length < 1 ? { x: 0, y: -1 } : { x: along.x / length, y: along.y / length };
  const across = { x: -axis.y, y: axis.x };
  const middle =
    part === null || part === "torso" ? prey.heart : lerp(prey.heart, tip, CUT_ALONG_LIMB);
  return {
    from: { x: middle.x - across.x * halfLength, y: middle.y - across.y * halfLength },
    to: { x: middle.x + across.x * halfLength, y: middle.y + across.y * halfLength },
  };
};

/**
 * A servant of the one under the page: two blades hinged on an eye, a ghost over the paper like
 * the Sumikui. It circles the body, winds up a cut it shows before it makes, lunges along it, and
 * rests. Each snip it lands quickens it a little, up to a ceiling.
 */
export class Snipper {
  private position: Vec;
  private facing: -1 | 1 = 1;
  private phase: SnipperPhase = { kind: "arriving" };
  private clock = 0;
  private orbit: number;
  private snips = 0;
  private hurtAtMs: number | null = null;
  health: number;

  constructor(
    readonly rank: SnipperRank,
    from: Vec,
    orbitAngle = 0,
  ) {
    this.position = from;
    this.orbit = orbitAngle;
    this.health = SNIPPER_TUNING[rank].health;
  }

  get tuning() {
    return SNIPPER_TUNING[this.rank];
  }

  get ramp(): number {
    return Math.min(this.tuning.maxSpeedRamp, 1 + this.snips * this.tuning.speedRampPerSnip);
  }

  get perished(): boolean {
    return this.phase.kind === "perishing";
  }

  get where(): Vec {
    return this.position;
  }

  get radius(): number {
    return this.tuning.radius;
  }

  get currentPhase(): SnipperPhase {
    return this.phase;
  }

  /** Takes a blow unless it was struck a moment ago; true when it did. */
  hurt(damage: number, from: Vec): boolean {
    if (this.perished || damage <= 0) return false;
    if (this.hurtAtMs !== null && this.clock - this.hurtAtMs < TEAR_TUNING.hitInvulnerableMs)
      return false;
    this.hurtAtMs = this.clock;
    this.health = Math.max(0, this.health - damage);
    const away = distance(this.position, from);
    if (away > 0) {
      const k = TEAR_TUNING.knockback / away;
      this.position = {
        x: this.position.x + (this.position.x - from.x) * k,
        y: this.position.y + (this.position.y - from.y) * k,
      };
    }
    if (this.health <= 0) this.phase = { kind: "perishing", fromMs: this.clock };
    else if (this.phase.kind === "winding" || this.phase.kind === "lunging")
      this.phase = { kind: "recovering", untilMs: this.clock + this.tuning.recoverMs };
    return true;
  }

  /** One tick; `mercy` holds every blade still after a snip has landed. */
  tick(elapsedMs: number, prey: Prey | null, mercy: boolean): SnipperDeed | null {
    this.clock += elapsedMs;
    const { tuning, ramp } = this;
    const phase = this.phase;
    switch (phase.kind) {
      case "perishing":
        return this.clock - phase.fromMs >= TEAR_TUNING.perishMs ? { kind: "perished" } : null;
      case "arriving": {
        const spot = this.orbitSpot(prey);
        this.drift(spot, tuning.approachSpeed * ramp * elapsedMs);
        if (distance(this.position, spot) <= ARRIVED_PX) this.circle(tuning.firstCircleMs);
        return null;
      }
      case "circling": {
        this.orbit += (tuning.orbitSpeed * ramp * elapsedMs) / 1000;
        this.drift(this.orbitSpot(prey), tuning.approachSpeed * ramp * elapsedMs);
        if (prey !== null && !mercy && this.clock >= phase.untilMs) this.windUp(prey);
        return null;
      }
      case "winding": {
        this.drift(phase.cut.from, tuning.approachSpeed * ramp * elapsedMs);
        this.face(phase.cut.to);
        if (this.clock >= phase.untilMs)
          this.phase = {
            ...phase,
            kind: "lunging",
            fromMs: this.clock,
            untilMs: this.clock + tuning.lungeMs,
          };
        return null;
      }
      case "lunging": {
        const t = clamp((this.clock - phase.fromMs) / (phase.untilMs - phase.fromMs), 0, 1);
        this.position = lerp(phase.cut.from, phase.cut.to, t);
        if (t < 1) return null;
        this.snips += 1;
        this.phase = { kind: "recovering", untilMs: this.clock + tuning.recoverMs };
        return { kind: "cut", cut: phase.cut, part: phase.part };
      }
      case "recovering": {
        this.drift(this.orbitSpot(prey), tuning.approachSpeed * ramp * elapsedMs * 0.5);
        if (this.clock >= phase.untilMs) this.circle();
        return null;
      }
    }
  }

  snapshot(): SnipperSnapshot {
    const phase = this.phase;
    return {
      rank: this.rank,
      position: this.position,
      radius: this.tuning.radius,
      facing: this.facing,
      phase: phase.kind,
      progress: this.progressOf(phase),
      cut: phase.kind === "winding" || phase.kind === "lunging" ? phase.cut : null,
      health: this.health / this.tuning.health,
      hurtAgoMs: this.hurtAtMs === null ? null : this.clock - this.hurtAtMs,
    };
  }

  private progressOf(phase: SnipperPhase): number {
    switch (phase.kind) {
      case "arriving":
        return 0;
      case "circling":
        return clamp(1 - (phase.untilMs - this.clock) / (this.tuning.circleMs / this.ramp), 0, 1);
      case "winding":
      case "lunging":
        return clamp((this.clock - phase.fromMs) / (phase.untilMs - phase.fromMs), 0, 1);
      case "recovering":
        return clamp(1 - (phase.untilMs - this.clock) / this.tuning.recoverMs, 0, 1);
      case "perishing":
        return clamp((this.clock - phase.fromMs) / TEAR_TUNING.perishMs, 0, 1);
    }
  }

  private circle(durationMs = this.tuning.circleMs): void {
    this.phase = { kind: "circling", untilMs: this.clock + durationMs / this.ramp };
  }

  private windUp(prey: Prey): void {
    const part = targetOf(prey.body);
    const cut = cutAcross(prey, part, this.tuning.cutReach * this.tuning.radius);
    this.phase = {
      kind: "winding",
      cut,
      part: part ?? "torso",
      fromMs: this.clock,
      untilMs: this.clock + this.tuning.windUpMs / this.ramp,
    };
  }

  private orbitSpot(prey: Prey | null): Vec {
    if (prey === null) return this.position;
    const r = this.tuning.orbitRadius;
    return {
      x: prey.heart.x + Math.cos(this.orbit) * r,
      y: prey.heart.y + Math.sin(this.orbit) * r,
    };
  }

  private drift(to: Vec, step: number): void {
    const next = towards(this.position, to, step);
    this.face(next);
    this.position = next;
  }

  private face(toward: Vec): void {
    if (toward.x !== this.position.x) this.facing = toward.x > this.position.x ? 1 : -1;
  }
}
