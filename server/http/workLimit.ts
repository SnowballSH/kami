const WINDOW_MS = 60_000;

export class WorkLimit {
  #windowStart = 0;
  #requests = 0;
  #active = 0;

  constructor(
    private readonly requestsPerMinute: number,
    private readonly concurrency: number,
    private readonly now: () => number = Date.now,
  ) {}

  enter(): (() => void) | null {
    const now = this.now();
    if (now >= this.#windowStart + WINDOW_MS) {
      this.#windowStart = now;
      this.#requests = 0;
    }
    if (this.#requests >= this.requestsPerMinute || this.#active >= this.concurrency) return null;
    this.#requests++;
    this.#active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active--;
    };
  }
}
