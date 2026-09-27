import type { Vec } from "../../core/geometry";
import type { AliceIndex, AliceSnapshot, SimEvent } from "../../sim/types";
import { AliceAnimator, type AliceCues } from "./aliceAnimator";
import type { AliceFigure } from "./aliceFigure";

const cuesFor = (
  events: readonly SimEvent[],
  who: AliceIndex,
  centers: ReadonlyMap<string, Vec> | undefined,
): AliceCues => {
  let warped = false;
  let devoured = false;
  let warp: AliceCues["warp"];
  for (const event of events) {
    if (event.type === "warped" && event.who === who) {
      const from = centers?.get(event.from);
      const to = centers?.get(event.to);
      if (from !== undefined && to !== undefined) warp = { from, to };
      else warped = true;
    }
    if (event.type === "alice-devoured" && event.who === who) devoured = true;
  }
  return warp === undefined ? { warped, devoured } : { warped, devoured, warp };
};

/** One animator per Alice on the board, Alice herself first; twins that leave take theirs with them. */
export class AliceTroupe {
  private readonly animators: AliceAnimator[] = [];

  forget(): void {
    this.animators.length = 0;
  }

  /** Call once per frame before asking for figures, with how many Alices are on the board. */
  count(alices: number): void {
    while (this.animators.length > alices) this.animators.pop();
    while (this.animators.length < alices) this.animators.push(new AliceAnimator());
  }

  figureOf(
    who: AliceIndex,
    alice: AliceSnapshot,
    events: readonly SimEvent[],
    nowMs: number,
    portalCenters?: ReadonlyMap<string, Vec>,
  ): AliceFigure {
    const animator = this.animators[who];
    if (animator === undefined) throw new RangeError(`No animator for Alice ${who}`);
    return animator.observe(alice, cuesFor(events, who, portalCenters), nowMs);
  }
}
