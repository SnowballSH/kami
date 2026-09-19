import type { CancelTimer, HubClock } from "../types";

interface PendingTimer {
  readonly at: number;
  readonly task: () => void;
}

/** A clock that only moves when a test says so, running due timers in order on the way. */
export class ManualClock implements HubClock {
  #now = 0;
  #timers: PendingTimer[] = [];

  now(): number {
    return this.#now;
  }

  schedule(task: () => void, delayMs: number): CancelTimer {
    const timer: PendingTimer = { at: this.#now + delayMs, task };
    this.#timers.push(timer);
    return () => this.#drop(timer);
  }

  advance(ms: number): void {
    const end = this.#now + ms;
    for (let due = this.#nextDueBy(end); due !== undefined; due = this.#nextDueBy(end)) {
      this.#drop(due);
      this.#now = due.at;
      due.task();
    }
    this.#now = end;
  }

  get pendingTimers(): number {
    return this.#timers.length;
  }

  #nextDueBy(end: number): PendingTimer | undefined {
    return this.#timers.filter(({ at }) => at <= end).sort((one, other) => one.at - other.at)[0];
  }

  #drop(timer: PendingTimer): void {
    this.#timers = this.#timers.filter((pending) => pending !== timer);
  }
}
