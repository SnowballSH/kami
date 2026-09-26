import type { Cadence } from "./types";

/** A pilot on her own may look again whenever her clock says so. */
export const UNHURRIED: Cadence = { mayReplan: () => true };

/**
 * Lets one pilot of a party take a routine re-plan per tick; the others wait a tick or two. Pilots
 * reset their clocks when they re-plan, so once spread they stay spread. Deterministic: whoever
 * asks first in a tick (the roster order) goes first.
 */
export class OnePerTick implements Cadence {
  private taken = false;

  nextTick(): void {
    this.taken = false;
  }

  mayReplan(): boolean {
    if (this.taken) return false;
    this.taken = true;
    return true;
  }
}
