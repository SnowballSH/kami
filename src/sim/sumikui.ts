import type Matter from "matter-js";
import { clamp, distance, distanceToRect, rectCenter, type Vec } from "../core/geometry";
import type { AliceController } from "./alice";
import { boundsRect } from "./bodyBounds";
import {
  SUMIKUI_BASE_SPEED,
  SUMIKUI_BITE_MS,
  SUMIKUI_CATCH_MS,
  SUMIKUI_CHEW_MS_PER_PX,
  SUMIKUI_DOUBLES_EVERY_MS,
  SUMIKUI_HALLOWED_PX,
  SUMIKUI_HOVER,
  SUMIKUI_LOSES_HER_PX,
  SUMIKUI_LUNGE_PX,
  SUMIKUI_MAX_SPEED,
  SUMIKUI_MEAL_MAX_MS,
  SUMIKUI_NEAR_PX,
  SUMIKUI_PAPER_BITE_MS,
  SUMIKUI_REACH,
  SUMIKUI_SATED_MS,
} from "./constants";
import type { InkEntity } from "./inkEntity";
import { NATURES } from "./natures";
import type { SumikuiPhase, SumikuiSnapshot } from "./types";

/** Everything on the paper it may hunt, this tick. `alices` is Alice first, then her clones. */
export interface HuntingGround {
  readonly alices: readonly [AliceController, ...AliceController[]];
  readonly inks: readonly InkEntity[];
  /** The board's own sketched solids, as they stand now. */
  readonly paper: readonly Matter.Body[];
}

export type Quarry =
  | { readonly kind: "ink"; readonly ink: InkEntity }
  /** A mouthful of the board's ground under this Alice's feet. */
  | { readonly kind: "paper"; readonly alice: AliceController }
  | { readonly kind: "alice"; readonly alice: AliceController };

interface Scored {
  readonly quarry: Quarry | null;
  readonly worth: number;
}

/** What she depends on outranks her; she outranks clutter far from either of them. */
const WORTH = {
  standingOn: 2,
  paper: 1.5,
  lunge: 1.2,
  alice: 0.3,
  besideHer: 0.5,
  loyalty: 0.25,
} as const;

export const speedAfter = (awakeMs: number): number =>
  clamp(SUMIKUI_BASE_SPEED * 2 ** (awakeMs / SUMIKUI_DOUBLES_EVERY_MS), 0, SUMIKUI_MAX_SPEED);

/** How long a drawing takes to eat: a pebble is gone in a moment, a long bridge takes a while. */
export const mealTimeFor = (inkPx: number): number =>
  Math.min(SUMIKUI_BITE_MS + SUMIKUI_CHEW_MS_PER_PX * inkPx, SUMIKUI_MEAL_MAX_MS);

const mealTimeOf = (ink: InkEntity): number => mealTimeFor(ink.drawing.cost * ink.motion.size);

/** What it will eat: any drawing that is not a role fixed to the board nor a prop of a scene. */
export const edible = (ink: InkEntity): boolean =>
  !NATURES[ink.nature].pinned && ink.provenance !== "scenery";

const nearness = (gap: number): number => 1 / (1 + gap / SUMIKUI_NEAR_PX);

const centreOf = (ink: InkEntity): Vec => rectCenter(boundsRect(ink.body.bounds));

const feetOf = (alice: AliceController): Vec => alice.feet();

const towards = (from: Vec, to: Vec, step: number): Vec => {
  const gap = distance(from, to);
  if (gap <= step) return to;
  const scale = step / gap;
  return { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale };
};

/**
 * The Sumikui, the ink eater. A ghost over the board, not a body in it, awake from the moment it
 * is summoned. Everything on the paper is ink to it: every drawing that is not part of the scene,
 * the board's own ground under her feet, and Alice herself. What she depends on comes first — the
 * ink she stands on, the ground beneath her, herself when she is close — and far clutter after;
 * where Kami sets her down is hallowed: neither that paper nor Alice standing on it. Its pace
 * doubles every `SUMIKUI_DOUBLES_EVERY_MS` awake, up to `SUMIKUI_MAX_SPEED`; devouring her gorges
 * it, and the pace starts over.
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
    private readonly pageEndY: number,
    private readonly options: { readonly bides: boolean },
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
    if (this.options.bides && !this.woke && !ground.inks.some(edible)) {
      this.drift(this.hoverSpotBehind(alice), elapsedMs);
      return null;
    }
    this.woke = true;
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

  snapshot(alices: readonly AliceController[]): SumikuiSnapshot {
    const prey =
      this.quarry !== null && this.quarry.kind !== "ink" ? alices.indexOf(this.quarry.alice) : -1;
    return {
      centre: this.centre,
      facing: this.facing,
      phase: this.phase(),
      quarry: this.quarry?.kind ?? null,
      prey: prey < 0 ? null : prey,
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
        return mealTimeOf(quarry.ink);
      case "paper":
        return SUMIKUI_PAPER_BITE_MS;
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

  /** What is between its teeth it keeps; what it is only stalking it trades for anything worthier. */
  private keepOrChooseQuarry(ground: HuntingGround): void {
    const kept = this.quarry !== null && this.stillWorthy(this.quarry, ground);
    if (kept && this.biteMs > 0) return;
    if (!kept) this.biteMs = 0;
    let best: Scored = { quarry: null, worth: Number.NEGATIVE_INFINITY };
    for (const quarry of this.candidates(ground)) {
      const worth = this.worthOf(quarry, ground);
      if (worth === null) continue;
      const loyal = kept && this.sameQuarry(quarry) ? WORTH.loyalty : 0;
      if (worth + loyal > best.worth) best = { quarry, worth: worth + loyal };
    }
    this.quarry = best.quarry;
  }

  private sameQuarry(other: Quarry): boolean {
    const { quarry } = this;
    if (quarry === null || quarry.kind !== other.kind) return false;
    if (quarry.kind === "ink") return other.kind === "ink" && quarry.ink === other.ink;
    return other.kind !== "ink" && quarry.alice === other.alice;
  }

  private stillWorthy(quarry: Quarry, ground: HuntingGround): boolean {
    switch (quarry.kind) {
      case "ink":
        return ground.inks.includes(quarry.ink) && edible(quarry.ink) && this.onThePage(quarry.ink);
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
    for (const each of ground.alices) yield { kind: "alice", alice: each };
    for (const each of ground.alices) {
      if (this.standsOnPaper(each, ground)) yield { kind: "paper", alice: each };
    }
    for (const ink of ground.inks) {
      if (edible(ink) && this.onThePage(ink)) yield { kind: "ink", ink };
    }
  }

  /** Ink that has fallen off the bottom of the page is lost to it too. */
  private onThePage(ink: InkEntity): boolean {
    return ink.body.position.y <= this.pageEndY;
  }

  private standsOnPaper(alice: AliceController, ground: HuntingGround): boolean {
    return ground.paper.some((body) => alice.standsOn(body));
  }

  /** How much she depends on `quarry`, or `null` for what it will not touch. */
  private worthOf(quarry: Quarry, ground: HuntingGround): number | null {
    switch (quarry.kind) {
      case "ink":
        return this.worthOfInk(quarry.ink, ground);
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

  /** Ink she stands on first, then ink near her, then whatever is nearest to it. */
  private worthOfInk(ink: InkEntity, ground: HuntingGround): number {
    const centre = centreOf(ink);
    const standingOn = ground.alices.some((alice) => alice.standsOn(ink.body));
    const nearestAlice = Math.min(
      ...ground.alices.map((alice) => distanceToRect(centre, alice.bounds())),
    );
    return (
      (standingOn ? WORTH.standingOn : 0) +
      WORTH.besideHer * nearness(nearestAlice) +
      this.nearnessOf(centre)
    );
  }

  private nearnessOf(spot: Vec): number {
    return nearness(distance(this.centre, spot));
  }
}
