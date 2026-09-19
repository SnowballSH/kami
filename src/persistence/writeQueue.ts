export type WriteTask = () => Promise<void>;

const ignoreFailure = (): void => undefined;

/**
 * Orders fire-and-forget writes. Writes to the same key within a scope run one after another,
 * different keys run side by side, and a barrier waits for everything before it in its scope
 * and holds back everything after it.
 */
export class WriteQueue {
  readonly #tails = new Map<string, Map<string, Promise<void>>>();
  readonly #barriers = new Map<string, Promise<void>>();

  enqueue(scope: string, key: string, task: WriteTask): Promise<void> {
    const tails = this.#tailsOf(scope);
    const previous = tails.get(key) ?? this.#barriers.get(scope) ?? Promise.resolve();
    const tail = previous.then(task).catch(ignoreFailure);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return tail;
  }

  enqueueBarrier(scope: string, task: WriteTask): Promise<void> {
    const tails = this.#tailsOf(scope);
    const before = [...tails.values(), this.#barriers.get(scope) ?? Promise.resolve()];
    tails.clear();
    const barrier = Promise.all(before).then(task).catch(ignoreFailure);
    this.#barriers.set(scope, barrier);
    void barrier.then(() => {
      if (this.#barriers.get(scope) === barrier) this.#barriers.delete(scope);
    });
    return barrier;
  }

  async whenIdle(): Promise<void> {
    const pending = [
      ...this.#barriers.values(),
      ...[...this.#tails.values()].flatMap((tails) => [...tails.values()]),
    ];
    if (pending.length === 0) return;
    await Promise.all(pending);
    await this.whenIdle();
  }

  #tailsOf(scope: string): Map<string, Promise<void>> {
    const existing = this.#tails.get(scope);
    if (existing !== undefined) return existing;
    const created = new Map<string, Promise<void>>();
    this.#tails.set(scope, created);
    return created;
  }
}
