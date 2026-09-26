import { wrappedAngle } from "../sim/paper";

export const TURN_STEP_DEGREES = 15;
/** How long the paper must hold still before the camera settles exactly on its angle. */
export const TURN_SETTLE_MS = 200;

/**
 * The paper's turn as the camera shows it. Smoothly, it is the paper's angle every frame. Without
 * motion, a turning page is shown in jumps of at least `TURN_STEP_DEGREES`, and the camera
 * settles on the exact angle once the page has stopped, so a small resting tilt still shows.
 */
export class SteppedTurn {
  private shown: number | null = null;
  private last: number | null = null;
  private changedAtMs = 0;

  follow(paperAngle: number, nowMs: number, smooth: boolean): number {
    if (paperAngle !== this.last) {
      this.last = paperAngle;
      this.changedAtMs = nowMs;
    }
    const resting = nowMs - this.changedAtMs >= TURN_SETTLE_MS;
    const stepped =
      this.shown !== null && Math.abs(wrappedAngle(paperAngle - this.shown)) >= TURN_STEP_DEGREES;
    if (smooth || resting || stepped || this.shown === null) this.shown = paperAngle;
    return this.shown;
  }
}
