export const DISARM_AFTER_MS = 3000;

export type ArmedListener = (armed: boolean) => void;

/**
 * A destructive action behind two taps: the first arms it, the second does it. It disarms on its
 * own after a few seconds, so a stray touch much later cannot finish what an earlier one began.
 */
export class ArmedTap {
  private disarming: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly act: () => void,
    private readonly onArmedChange: ArmedListener,
    private readonly disarmAfterMs: number = DISARM_AFTER_MS,
  ) {}

  get armed(): boolean {
    return this.disarming !== null;
  }

  tap(): void {
    if (!this.armed) {
      this.setArmed(true);
      return;
    }
    this.setArmed(false);
    this.act();
  }

  disarm(): void {
    if (this.armed) this.setArmed(false);
  }

  private setArmed(armed: boolean): void {
    if (this.disarming !== null) clearTimeout(this.disarming);
    this.disarming = armed ? setTimeout(() => this.setArmed(false), this.disarmAfterMs) : null;
    this.onArmedChange(armed);
  }
}
