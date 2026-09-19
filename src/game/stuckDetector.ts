const IDLE_LIMIT_MS = 45_000;
const FALL_LIMIT = 3;

/** Spec §6: the Cat notices after 45 seconds without progress, or three falls. */
export class StuckDetector {
  private lastProgressMs = 0;
  private falls = 0;

  reset(nowMs: number): void {
    this.lastProgressMs = nowMs;
    this.falls = 0;
  }

  progress(nowMs: number): void {
    this.reset(nowMs);
  }

  fell(): void {
    this.falls += 1;
  }

  isStuck(nowMs: number): boolean {
    return this.falls >= FALL_LIMIT || nowMs - this.lastProgressMs >= IDLE_LIMIT_MS;
  }
}
