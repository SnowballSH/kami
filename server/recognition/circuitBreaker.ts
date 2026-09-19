/**
 * Stops asking something that keeps failing. After `failureThreshold` failures in a row the breaker
 * opens for `coolDownMs`; then it lets exactly one probe through per cool-down until one succeeds.
 */
export interface CircuitBreakerOptions {
  readonly failureThreshold: number;
  readonly coolDownMs: number;
}

export type Clock = () => number;

export class CircuitBreaker {
  readonly #options: CircuitBreakerOptions;
  readonly #now: Clock;
  #consecutiveFailures = 0;
  #openedAt: number | null = null;

  constructor(options: CircuitBreakerOptions, now: Clock = Date.now) {
    this.#options = options;
    this.#now = now;
  }

  get isOpen(): boolean {
    return this.#openedAt !== null;
  }

  tryEnter(): boolean {
    if (this.#openedAt === null) return true;
    if (this.#now() - this.#openedAt < this.#options.coolDownMs) return false;
    this.#openedAt = this.#now();
    return true;
  }

  recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#openedAt = null;
  }

  recordFailure(): void {
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#options.failureThreshold) this.#openedAt = this.#now();
  }
}
