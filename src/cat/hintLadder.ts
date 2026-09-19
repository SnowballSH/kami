import type { Hint, HintTier, RoomBrief } from "./types";

const RUNGS: readonly HintTier[] = [1, 2, 3];
const TOP_RUNG: HintTier = 3;

export class HintLadder {
  readonly #lines: Readonly<Record<HintTier, string>>;
  #climbed = 0;

  constructor([nudge, direction, answer]: RoomBrief["hints"]) {
    this.#lines = { 1: nudge, 2: direction, 3: answer };
  }

  climb(): Hint {
    const tier = RUNGS[this.#climbed] ?? TOP_RUNG;
    this.#climbed = Math.min(this.#climbed + 1, RUNGS.length);
    return { tier, line: this.#lines[tier] };
  }
}
