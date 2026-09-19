export class FixedStepLoop {
  private accumulatedMs = 0;

  constructor(
    private readonly stepMs: number,
    private readonly maxStepsPerFrame: number,
  ) {}

  /** How many fixed steps are due after `elapsedMs` of real time. Excess backlog is dropped. */
  advance(elapsedMs: number): number {
    this.accumulatedMs += Math.max(0, elapsedMs);
    const due = Math.floor(this.accumulatedMs / this.stepMs);
    const steps = Math.min(due, this.maxStepsPerFrame);
    this.accumulatedMs = due > steps ? 0 : this.accumulatedMs - steps * this.stepMs;
    return steps;
  }
}
