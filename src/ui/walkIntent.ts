import type { Axis, WalkIntent } from "../sim/types";

export const DIRECTIONS = ["left", "right", "up", "down"] as const;

export type Direction = (typeof DIRECTIONS)[number];

export type PressedListener = (pressed: ReadonlySet<Direction>) => void;

export const IDLE_INTENT: WalkIntent = { x: 0, y: 0 };

const axis = (negative: boolean, positive: boolean): Axis => {
  if (negative === positive) return 0;
  return positive ? 1 : -1;
};

export const toWalkIntent = (pressed: ReadonlySet<Direction>): WalkIntent => ({
  x: axis(pressed.has("left"), pressed.has("right")),
  y: axis(pressed.has("up"), pressed.has("down")),
});

const sameIntent = (a: WalkIntent, b: WalkIntent): boolean => a.x === b.x && a.y === b.y;

/** Unions what every input source is holding and reports the intent only when it changes. */
export class WalkIntentMerger {
  private readonly emit: (intent: WalkIntent) => void;
  private readonly pressedBySource: ReadonlySet<Direction>[] = [];
  private current: WalkIntent = IDLE_INTENT;

  constructor(emit: (intent: WalkIntent) => void) {
    this.emit = emit;
  }

  source(): PressedListener {
    const index = this.pressedBySource.push(new Set()) - 1;
    return (pressed) => {
      this.pressedBySource[index] = new Set(pressed);
      this.refresh();
    };
  }

  private refresh(): void {
    const held = new Set(this.pressedBySource.flatMap((pressed) => [...pressed]));
    const next = toWalkIntent(held);
    if (sameIntent(next, this.current)) return;
    this.current = next;
    this.emit(next);
  }
}
