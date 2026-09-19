import type Matter from "matter-js";
import { clamp, distance, distanceToRect, rectCenter, type Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import type { AliceController } from "./alice";
import { boundsRect } from "./bodyBounds";
import {
  SUMIKUI_BASE_SPEED,
  SUMIKUI_BITE_MS,
  SUMIKUI_CATCH_MS,
  SUMIKUI_DOUBLES_EVERY_MS,
  SUMIKUI_GULP_MS,
  SUMIKUI_HALLOWED_PX,
  SUMIKUI_HOVER,
  SUMIKUI_LOSES_HER_PX,
  SUMIKUI_LUNGE_PX,
  SUMIKUI_MAX_SPEED,
  SUMIKUI_MEMORY_MS,
  SUMIKUI_NEAR_PX,
  SUMIKUI_REACH,
  SUMIKUI_SATED_MS,
  SUMIKUI_SWEEPS_AFTER_MS,
  SUMIKUI_WAKES_AT_DRAWINGS,
} from "./constants";
import type { InkEntity } from "./inkEntity";
import { NATURES } from "./natures";
import type { SumikuiPhase, SumikuiSnapshot } from "./types";

/** What the board remembers of Alice using its ink: the moment she last touched each drawing. */
export type InkMemory = ReadonlyMap<DrawingId, number>;

/** Everything on the paper it may hunt, this tick. `alices` is Alice first, then her clones. */
export interface HuntingGround {
  readonly now: number;
  readonly alices: readonly [AliceController, ...AliceController[]];
  readonly inks: readonly InkEntity[];
  readonly memory: InkMemory;
  /** The board's own sketched solids, as they stand now. */
  readonly paper: readonly Matter.Body[];
}

export type Quarry =
  /** A drawing; `gulp` when it is clutter she never used, swept up in one shot once it is quick. */
  | { readonly kind: "ink"; readonly ink: InkEntity; readonly gulp: boolean }
  /** A mouthful of the board's ground under this Alice's feet. */
  | { readonly kind: "paper"; readonly alice: AliceController }
  | { readonly kind: "alice"; readonly alice: AliceController };

interface Scored {
  readonly quarry: Quarry;
  readonly worth: number;
}

const WORTH = { standingOn: 2, paper: 1.5, lunge: 3, alice: 0.5, clutter: 0.1 } as const;

export const speedAfter = (awakeMs: number): number =>
  clamp(SUMIKUI_BASE_SPEED * 2 ** (awakeMs / SUMIKUI_DOUBLES_EVERY_MS), 0, SUMIKUI_MAX_SPEED);

const centreOf = (ink: InkEntity): Vec => rectCenter(boundsRect(ink.body.bounds));

const feetOf = (alice: AliceController): Vec => alice.feet();

const towards = (from: Vec, to: Vec, step: number): Vec => {
  const gap = distance(from, to);
  if (gap <= step) return to;
  const scale = step / gap;
  return { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale };
};

/**
 * The Sumikui, the ink eater. A ghost over the board, not a body in it. Everything on the paper is
 * ink to it: the drawings Alice leans on, the board's own ground under her feet, and Alice herself.
 * It never touches ink she has not used, so untouched scribbles are never bait, and where Kami sets
 * her down is hallowed: neither that paper nor Alice standing on it. Its pace doubles every `SUMIKUI_DOUBLES_EVERY_MS` awake, up
 * to `SUMIKUI_MAX_SPEED`; devouring her gorges it, and the pace starts over.
 */
export class Sumikui {
  private centre: Vec;
  private facing: -1 | 1 = 1;
  private awakeMs = 0;
  private satedMs = 0;
  private woke = false;
  private quarry: Quarry | null = null;
  private biteMs = 0;

  constructor(
    alice: AliceController,
    private readonly hallowed: readonly Vec[],
  ) {
    this.centre = this.hoverSpotBehind(alice);
  }

  get isAwake(): boolean {
    return this.woke;
  }

  get speed(): number {
    return speedAfter(this.awakeMs);
  }

  /** Advances one tick; returns what it has finished devouring, if anything. */
  tick(elapsedMs: number, ground: HuntingGround): Quarry | null {
    const [alice] = ground.alices;
    if (!this.woke) {
      this.woke = ground.inks.length >= SUMIKUI_WAKES_AT_DRAWINGS;
      this.drift(this.hoverSpotBehind(alice), elapsedMs);
      return null;
    }
    this.awakeMs += elapsedMs;
    if (this.satedMs > 0) {
      this.satedMs = Math.max(0, this.satedMs - elapsedMs);
      this.drift(this.hoverSpotBehind(alice), elapsedMs);
      return null;
    }
    this.keepOrChooseQuarry(ground);
    if (this.quarry === null) {
      this.drift(this.hoverSpotBehind(alice), elapsedMs);
      return null;
    }
    const mouthful = this.mouthfulOf(this.quarry);
    if (!this.withinReach(this.quarry, mouthful)) {
      this.biteMs = 0;
      this.drift(mouthful, elapsedMs);
      return null;
    }
    this.drift(mouthful, elapsedMs);
    this.biteMs += elapsedMs;
    if (this.biteMs < this.mealTimeOf(this.quarry)) return null;
    return this.finish();
  }

  snapshot(): SumikuiSnapshot {
    return {
      centre: this.centre,
      facing: this.facing,
      phase: this.phase(),
      quarry: this.quarry?.kind ?? null,
      chewing: this.quarry?.kind === "ink" && this.biteMs > 0 ? this.quarry.ink.id : null,
      bite: this.quarry === null ? 0 : clamp(this.biteMs / this.mealTimeOf(this.quarry), 0, 1),
      awakeMs: this.awakeMs,
    };
  }

  private phase(): SumikuiPhase {
    if (!this.woke) return "stirring";
    if (this.satedMs > 0) return "sated";
    if (this.quarry === null) return "prowling";
    return this.biteMs > 0 ? "feeding" : "hunting";
  }

  private finish(): Quarry {
    const meal = this.quarry;
    if (meal === null) throw new Error("nothing in its mouth");
    this.quarry = null;
    this.biteMs = 0;
    if (meal.kind === "alice") {
      this.awakeMs = 0;
      this.satedMs = SUMIKUI_SATED_MS;
    }
    return meal;
  }

  private mouthfulOf(quarry: Quarry): Vec {
    switch (quarry.kind) {
      case "ink":
        return centreOf(quarry.ink);
      case "paper":
        return feetOf(quarry.alice);
      case "alice":
        return quarry.alice.body.position;
    }
  }

  private mealTimeOf(quarry: Quarry): number {
    switch (quarry.kind) {
      case "ink":
        return quarry.gulp ? SUMIKUI_GULP_MS : SUMIKUI_BITE_MS;
      case "paper":
        return SUMIKUI_BITE_MS;
      case "alice":
        return SUMIKUI_CATCH_MS;
    }
  }

  private withinReach(quarry: Quarry, mouthful: Vec): boolean {
    if (quarry.kind === "alice") {
      return distanceToRect(this.centre, quarry.alice.bounds()) <= SUMIKUI_REACH;
    }
    return distance(this.centre, mouthful) <= SUMIKUI_REACH;
  }

  private hoverSpotBehind(alice: AliceController): Vec {
    const { x, y } = alice.body.position;
    const behind = alice.velocity.x >= 0 ? -1 : 1;
    return { x: x + behind * SUMIKUI_HOVER.x, y: y + SUMIKUI_HOVER.y };
  }

  private drift(to: Vec, elapsedMs: number): void {
    const step = this.speed * elapsedMs;
    const next = towards(this.centre, to, step);
    if (next.x !== this.centre.x) this.facing = next.x > this.centre.x ? 1 : -1;
    this.centre = next;
  }

  private keepOrChooseQuarry(ground: HuntingGround): void {
    if (this.quarry !== null && this.stillWorthy(this.quarry, ground)) return;
    this.quarry = null;
    this.biteMs = 0;
    let best: Scored | null = null;
    for (const quarry of this.candidates(ground)) {
      const worth = this.worthOf(quarry, ground);
      if (worth !== null && (best === null || worth > best.worth)) best = { quarry, worth };
    }
    this.quarry = best?.quarry ?? null;
  }

  private stillWorthy(quarry: Quarry, ground: HuntingGround): boolean {
    switch (quarry.kind) {
      case "ink":
        return ground.inks.includes(quarry.ink) && !NATURES[quarry.ink.nature].pinned;
      case "paper":
        return this.standsOnPaper(quarry.alice, ground) && !this.isHallowed(feetOf(quarry.alice));
      case "alice":
        return (
          !this.isHallowed(feetOf(quarry.alice)) &&
          distance(this.centre, quarry.alice.body.position) <= SUMIKUI_LOSES_HER_PX
        );
    }
  }

  private *candidates(ground: HuntingGround): Generator<Quarry> {
    const [alice] = ground.alices;
    yield { kind: "alice", alice };
    for (const each of ground.alices) {
      if (this.standsOnPaper(each, ground)) yield { kind: "paper", alice: each };
    }
    for (const ink of ground.inks) {
      if (NATURES[ink.nature].pinned) continue;
      const used = this.usedBy(ink, ground) !== null;
      if (used) yield { kind: "ink", ink, gulp: false };
      else if (this.sweeps && ink.nature === "ink") yield { kind: "ink", ink, gulp: true };
    }
  }

  private standsOnPaper(alice: AliceController, ground: HuntingGround): boolean {
    return ground.paper.some((body) => alice.standsOn(body));
  }

  /** Once it has grown quick, clutter she never touched is not worth stalking: it is swept up. */
  private get sweeps(): boolean {
    return this.awakeMs >= SUMIKUI_SWEEPS_AFTER_MS;
  }

  /** How freshly she leaned on `ink`, 1 for standing on it now, or `null` if she never did. */
  private usedBy(ink: InkEntity, { now, alices, memory }: HuntingGround): number | null {
    if (alices.some((alice) => alice.standsOn(ink.body))) return 1;
    const touchedAt = memory.get(ink.id);
    if (touchedAt === undefined) return null;
    const age = now - touchedAt;
    return age > SUMIKUI_MEMORY_MS ? null : 1 - age / SUMIKUI_MEMORY_MS;
  }

  /** How much she depends on `quarry`, or `null` for what it will not touch. */
  private worthOf(quarry: Quarry, ground: HuntingGround): number | null {
    switch (quarry.kind) {
      case "ink":
        return quarry.gulp
          ? WORTH.clutter + this.nearnessOf(centreOf(quarry.ink)) / 2
          : this.worthOfInk(quarry.ink, ground);
      case "paper": {
        const feet = feetOf(quarry.alice);
        return this.isHallowed(feet) ? null : WORTH.paper + this.nearnessOf(feet);
      }
      case "alice": {
        const { alice } = quarry;
        if (this.isHallowed(feetOf(alice))) return null;
        const gap = distanceToRect(this.centre, alice.bounds());
        return gap <= SUMIKUI_LUNGE_PX
          ? WORTH.lunge
          : WORTH.alice + this.nearnessOf(alice.body.position);
      }
    }
  }

  /** Where Kami set her down is not for eating: neither the paper there nor her while she stands on it. */
  private isHallowed(spot: Vec): boolean {
    return this.hallowed.some((sanctuary) => distance(sanctuary, spot) <= SUMIKUI_HALLOWED_PX);
  }

  private worthOfInk(ink: InkEntity, ground: HuntingGround): number | null {
    const freshness = this.usedBy(ink, ground);
    if (freshness === null) return null;
    const standingOn = ground.alices.some((alice) => alice.standsOn(ink.body));
    return (standingOn ? WORTH.standingOn : 0) + freshness + this.nearnessOf(centreOf(ink));
  }

  private nearnessOf(spot: Vec): number {
    return 1 / (1 + distance(this.centre, spot) / SUMIKUI_NEAR_PX);
  }
}
