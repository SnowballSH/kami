import type { Stroke } from "../../src/core/geometry";
import type { HandwritingTranscriber, TranscribeOptions } from "./types";

export interface NamedTranscriber {
  /** What the start-up log calls it, e.g. "local reader (http://127.0.0.1:8790)". */
  readonly name: string;
  readonly transcriber: HandwritingTranscriber;
}

/**
 * Handwriting readers in order of preference: warming up picks the first whose start-up check
 * passes, and that one alone reads from then on. A later warm-up chooses again.
 */
export class FirstReadyTranscriber implements HandwritingTranscriber {
  readonly #candidates: readonly NamedTranscriber[];
  #chosen: NamedTranscriber | null = null;

  constructor(candidates: readonly NamedTranscriber[]) {
    this.#candidates = candidates;
  }

  get ready(): boolean {
    return this.#chosen?.transcriber.ready ?? false;
  }

  /** The reader answering /api/transcribe, once one has passed its check. */
  get chosen(): string | null {
    return this.#chosen?.name ?? null;
  }

  get candidates(): readonly string[] {
    return this.#candidates.map(({ name }) => name);
  }

  async warmUp(): Promise<boolean> {
    this.#chosen = null;
    for (const candidate of this.#candidates) {
      if (await candidate.transcriber.warmUp()) {
        this.#chosen = candidate;
        return true;
      }
    }
    return false;
  }

  transcribe(strokes: readonly Stroke[], options?: TranscribeOptions): Promise<string | null> {
    return this.#chosen?.transcriber.transcribe(strokes, options) ?? Promise.resolve(null);
  }
}
