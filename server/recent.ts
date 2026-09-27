/** Remembers the latest `capacity` answers by key, forgetting the least recently used first. */
export class Recent<V> {
  readonly #entries = new Map<string, V>();
  readonly #capacity: number;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  get(key: string): V | undefined {
    const value = this.#entries.get(key);
    if (value !== undefined) this.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#capacity) break;
      this.#entries.delete(oldest);
    }
  }
}
