import type { Vec } from "../../core/geometry";
import type { AliceIndex, AliceSnapshot, SimEvent } from "../../sim/types";
import { AliceAnimator, type AliceCues } from "./aliceAnimator";
import type { AliceFigure } from "./aliceFigure";

interface MutableCues {
  warped: boolean;
  devoured: boolean;
  warp: { from: Vec; to: Vec } | undefined;
}

const cuesFor = (
  out: MutableCues,
  events: readonly SimEvent[],
  who: AliceIndex,
  centers: ReadonlyMap<string, Vec> | undefined,
): AliceCues => {
  out.warped = false;
  out.devoured = false;
  out.warp = undefined;
  for (const event of events) {
    if (event.type === "warped" && event.who === who) {
      const from = centers?.get(event.from);
      const to = centers?.get(event.to);
      if (from !== undefined && to !== undefined) out.warp = { from, to };
      else out.warped = true;
    }
    if (event.type === "alice-devoured" && event.who === who) out.devoured = true;
  }
  return {
    warped: out.warped,
    devoured: out.devoured,
    ...(out.warp === undefined ? {} : { warp: out.warp }),
  };
};

/** One animator per Alice on the board, Alice herself first; twins that leave take theirs with them. */
export class AliceTroupe {
  private readonly animators: AliceAnimator[] = [];
  private readonly cues: MutableCues = { warped: false, devoured: false, warp: undefined };

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
    return animator.observe(alice, cuesFor(this.cues, events, who, portalCenters), nowMs);
  }
}
