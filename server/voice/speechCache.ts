/** Kami repeats himself — "And what is that supposed to be?" is said to every judge who draws. */
export class SpeechCache {
  readonly #spoken = new Map<string, ArrayBuffer>();
  readonly #budgetBytes: number;
  #heldBytes = 0;

  constructor(budgetBytes: number) {
    this.#budgetBytes = budgetBytes;
  }

  get(line: string): ArrayBuffer | null {
    const audio = this.#spoken.get(line);
    if (audio === undefined) return null;
    this.#spoken.delete(line);
    this.#spoken.set(line, audio);
    return audio;
  }

  keep(line: string, audio: ArrayBuffer): void {
    if (audio.byteLength > this.#budgetBytes) return;
    this.#drop(line);
    this.#spoken.set(line, audio);
    this.#heldBytes += audio.byteLength;
    for (const oldest of this.#spoken.keys()) {
      if (this.#heldBytes <= this.#budgetBytes) break;
      this.#drop(oldest);
    }
  }

  get size(): number {
    return this.#spoken.size;
  }

  #drop(line: string): void {
    const audio = this.#spoken.get(line);
    if (audio === undefined) return;
    this.#spoken.delete(line);
    this.#heldBytes -= audio.byteLength;
  }
}
