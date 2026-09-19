import { clamp, distance, rectCenter, type Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import type { AliceController } from "./alice";
import { boundsRect } from "./bodyBounds";
import {
  SUMIKUI_BASE_SPEED,
  SUMIKUI_BITE_MS,
  SUMIKUI_DOUBLES_EVERY_MS,
  SUMIKUI_HOVER,
  SUMIKUI_MAX_SPEED,
  SUMIKUI_MEMORY_MS,
  SUMIKUI_NEAR_PX,
  SUMIKUI_REACH,
  SUMIKUI_WAKES_AT_DRAWINGS,
} from "./constants";
import type { InkEntity } from "./inkEntity";
import { NATURES } from "./natures";
import type { SumikuiPhase, SumikuiSnapshot } from "./types";

/** What the board remembers of Alice using its ink: the moment she last touched each drawing. */
export type InkMemory = ReadonlyMap<DrawingId, number>;

interface Prey {
  readonly ink: InkEntity;
  readonly worth: number;
}

export const speedAfter = (awakeMs: number): number =>
  clamp(SUMIKUI_BASE_SPEED * 2 ** (awakeMs / SUMIKUI_DOUBLES_EVERY_MS), 0, SUMIKUI_MAX_SPEED);

const centreOf = (ink: InkEntity): Vec => rectCenter(boundsRect(ink.body.bounds));

const towards = (from: Vec, to: Vec, step: number): Vec => {
  const gap = distance(from, to);
  if (gap <= step) return to;
  const scale = step / gap;
  return { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale };
};

/**
 * The Sumikui, the ink eater. A ghost over the board, not a body in it: it drifts behind Alice,
 * and hunts only the ink she has actually used, so untouched scribbles are never bait. Its pace
 * doubles every `SUMIKUI_DOUBLES_EVERY_MS` awake, up to `SUMIKUI_MAX_SPEED`.
 */
export class Sumikui {
  private centre: Vec;
  private facing: -1 | 1 = 1;
  private awakeMs = 0;
  private woke = false;
  private prey: InkEntity | null = null;
  private biteMs = 0;

  constructor(alice: AliceController) {
    this.centre = this.hoverSpotBehind(alice);
  }

  get isAwake(): boolean {
    return this.woke;
  }

  get speed(): number {
    return speedAfter(this.awakeMs);
  }

  /**
   * Advances one tick; returns the drawing it has finished devouring, if any. `alices` is Alice
   * first, then her clones: it shadows her, but ink under any of them counts as used.
   */
  tick(
    elapsedMs: number,
    now: number,
    alices: readonly [AliceController, ...AliceController[]],
    inks: readonly InkEntity[],
    memory: InkMemory,
  ): InkEntity | null {
    const [alice] = alices;
    if (!this.woke) {
      this.woke = inks.length >= SUMIKUI_WAKES_AT_DRAWINGS;
      this.drift(this.hoverSpotBehind(alice), elapsedMs);
      return null;
    }
    this.awakeMs += elapsedMs;
    this.keepOrChoosePrey(now, alices, inks, memory);
    if (this.prey === null) {
      this.drift(this.hoverSpotBehind(alice), elapsedMs);
      return null;
    }
    const mouthful = centreOf(this.prey);
    if (distance(this.centre, mouthful) > SUMIKUI_REACH) {
      this.biteMs = 0;
      this.drift(mouthful, elapsedMs);
      return null;
    }
    this.centre = mouthful;
    this.biteMs += elapsedMs;
    if (this.biteMs < SUMIKUI_BITE_MS) return null;
    const eaten = this.prey;
    this.prey = null;
    this.biteMs = 0;
    return eaten;
  }

  snapshot(): SumikuiSnapshot {
    return {
      centre: this.centre,
      facing: this.facing,
      phase: this.phase(),
      bite: clamp(this.biteMs / SUMIKUI_BITE_MS, 0, 1),
      awakeMs: this.awakeMs,
    };
  }

  private phase(): SumikuiPhase {
    if (!this.woke) return "stirring";
    if (this.prey === null) return "prowling";
    return this.biteMs > 0 ? "feeding" : "hunting";
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

  private keepOrChoosePrey(
    now: number,
    alices: readonly AliceController[],
    inks: readonly InkEntity[],
    memory: InkMemory,
  ): void {
    if (this.prey !== null && inks.includes(this.prey) && !NATURES[this.prey.nature].pinned) return;
    this.prey = null;
    this.biteMs = 0;
    let best: Prey | null = null;
    for (const ink of inks) {
      const worth = this.worthOf(ink, now, alices, memory);
      if (worth !== null && (best === null || worth > best.worth)) best = { ink, worth };
    }
    this.prey = best?.ink ?? null;
  }

  /** How much Alice depends on `ink`: `null` for ink she has never used, which is bait. */
  private worthOf(
    ink: InkEntity,
    now: number,
    alices: readonly AliceController[],
    memory: InkMemory,
  ): number | null {
    if (NATURES[ink.nature].pinned) return null;
    const standingOn = alices.some((alice) => alice.standsOn(ink.body));
    const touchedAt = memory.get(ink.id);
    const age = touchedAt === undefined ? Number.POSITIVE_INFINITY : now - touchedAt;
    if (!standingOn && age > SUMIKUI_MEMORY_MS) return null;
    const freshness = standingOn ? 1 : 1 - age / SUMIKUI_MEMORY_MS;
    const nearness = 1 / (1 + distance(this.centre, centreOf(ink)) / SUMIKUI_NEAR_PX);
    return (standingOn ? 2 : 0) + freshness + nearness;
  }
}
