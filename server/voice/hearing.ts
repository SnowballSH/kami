import type { Heard } from "./deepgram";

/**
 * One utterance, assembled from Deepgram's stream: settled words are kept in order, the words
 * still under revision are shown after them and replaced by the next message.
 */
export class Hearing {
  #settled: string[] = [];
  #pending = "";

  /** True when the utterance so far changed and the player should see it. */
  take({ text, settled }: Heard): boolean {
    if (settled) {
      this.#pending = "";
      if (text === "") return false;
      this.#settled.push(text);
      return true;
    }
    if (text === this.#pending) return false;
    this.#pending = text;
    return true;
  }

  get transcript(): string {
    return [...this.#settled, this.#pending].filter((part) => part !== "").join(" ");
  }

  get settledTranscript(): string {
    return this.#settled.join(" ");
  }

  /** Start the next utterance: what was settled has been handed on. */
  reset(): void {
    this.#settled = [];
    this.#pending = "";
  }
}
