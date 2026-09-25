interface Waiting {
  readonly start: () => Promise<void>;
  readonly settle: () => void;
}

/**
 * Runs tasks one at a time, in order. A task whose signal aborts while it waits is dropped without
 * running, and a task that finds the queue full is refused: both resolve to `null`, as does a task
 * that throws. The pen asks again on every lift and gives up on the previous question, so most
 * waiting reads never run.
 */
export class SerialQueue {
  readonly #capacity: number;
  readonly #waiting: Waiting[] = [];
  #busy = false;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted || this.#waiting.length >= this.#capacity) return Promise.resolve(null);
    return new Promise<T | null>((resolve) => {
      const drop = (): void => {
        const index = this.#waiting.indexOf(entry);
        if (index < 0) return;
        this.#waiting.splice(index, 1);
        resolve(null);
      };
      const entry: Waiting = {
        settle: () => signal?.removeEventListener("abort", drop),
        start: () => task().then(resolve, () => resolve(null)),
      };
      signal?.addEventListener("abort", drop, { once: true });
      this.#waiting.push(entry);
      this.#next();
    });
  }

  #next(): void {
    if (this.#busy) return;
    const entry = this.#waiting.shift();
    if (entry === undefined) return;
    entry.settle();
    this.#busy = true;
    void entry.start().finally(() => {
      this.#busy = false;
      this.#next();
    });
  }
}
