import type { Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { PORTAL_LONELY_COOLDOWN_MS } from "./constants";
import type { InkEntity } from "./inkEntity";
import type { AliceIndex, SimEvent } from "./types";

/** Portals let out into the next portal drawn after them, and the last one back into the first. */
export const exitOf = (portal: InkEntity, inks: readonly InkEntity[]): InkEntity | null => {
  const portals = inks.filter((ink) => ink.nature === "portal");
  const at = portals.indexOf(portal);
  if (at < 0 || portals.length < 2) return null;
  return portals[(at + 1) % portals.length] ?? null;
};

export const centreOf = (ink: InkEntity): Vec => {
  const { min, max } = ink.body.bounds;
  return { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
};

/**
 * Keeps one Alice from being swallowed straight back by the portal she just stepped out of: that
 * one refuses her until she has left it once. Each Alice has her own.
 */
export class Portals {
  private steppedOutOf: DrawingId | null = null;
  private lonelyAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly who: AliceIndex) {}

  /** The portal to bar this tick, decided before any touch is resolved. */
  barred(): DrawingId | null {
    return this.steppedOutOf;
  }

  /** Where Alice comes out of `portal`, or `null` (with an event, now and then) if it has no twin. */
  through(
    portal: InkEntity,
    inks: readonly InkEntity[],
    now: number,
    emit: (event: SimEvent) => void,
  ): InkEntity | null {
    if (portal.id === this.steppedOutOf) return null;
    const exit = exitOf(portal, inks);
    if (exit === null) {
      if (now - this.lonelyAt > PORTAL_LONELY_COOLDOWN_MS) {
        this.lonelyAt = now;
        emit({ type: "portal-lonely", drawingId: portal.id });
      }
      return null;
    }
    this.steppedOutOf = exit.id;
    emit({ type: "warped", who: this.who, from: portal.id, to: exit.id });
    return exit;
  }

  /** Called once the tick's touches are known; the bar lifts once Alice is clear of that portal. */
  settle(barred: DrawingId | null, touched: ReadonlySet<DrawingId>): void {
    if (barred !== null && this.steppedOutOf === barred && !touched.has(barred)) {
      this.steppedOutOf = null;
    }
  }

  forget(id: DrawingId): void {
    if (this.steppedOutOf === id) this.steppedOutOf = null;
  }
}
