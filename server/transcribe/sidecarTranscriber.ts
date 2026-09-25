import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";
import { type AuthenticatedEndpoint, endpointHeaders } from "../http/endpoint";
import { sidecarUrl } from "../recognition/sidecarUrl";
import type { FetchLike } from "../recognition/types";
import { fetchSidecarCapabilities } from "../sidecar/health";
import { HI_STROKES } from "./hiStrokes";
import { SerialQueue } from "./serialQueue";
import { asWriting, type HandwritingTranscriber, type TranscribeOptions } from "./types";

export interface SidecarTranscriberTiming {
  /** How long one read may take, queueing in the sidecar included. */
  readonly requestTimeoutMs: number;
  /** How long start-up waits for the sidecar to load its handwriting model. */
  readonly warmUpTimeoutMs: number;
  /** How often start-up looks again while the sidecar is not up yet. */
  readonly pollMs: number;
}

export const DEFAULT_SIDECAR_TIMING: SidecarTranscriberTiming = {
  requestTimeoutMs: 10_000,
  warmUpTimeoutMs: 120_000,
  pollMs: 1_000,
};

/** Reads are one at a time (the sidecar has one thread to spare); this many may wait. */
const MAX_WAITING_READS = 8;

const readSchema = z.object({ text: z.string().nullable() });

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads handwriting with the sidecar's local models (`POST /read`, ml/CONTRACT.md). Ready once the
 * sidecar says it has a handwriting model and has answered one read; any failure is a `null`.
 */
export class SidecarTranscriber implements HandwritingTranscriber {
  readonly #endpoint: AuthenticatedEndpoint;
  readonly #fetch: FetchLike;
  readonly #timing: SidecarTranscriberTiming;
  readonly #queue = new SerialQueue(MAX_WAITING_READS);
  #ready = false;

  constructor(
    endpoint: AuthenticatedEndpoint,
    fetchFn: FetchLike = fetch,
    timing: SidecarTranscriberTiming = DEFAULT_SIDECAR_TIMING,
  ) {
    this.#endpoint = endpoint;
    this.#fetch = fetchFn;
    this.#timing = timing;
  }

  get ready(): boolean {
    return this.#ready;
  }

  async warmUp(): Promise<boolean> {
    this.#ready = false;
    const deadline = Date.now() + this.#timing.warmUpTimeoutMs;
    for (;;) {
      const capabilities = await fetchSidecarCapabilities(this.#endpoint, this.#fetch);
      if (capabilities !== null) {
        this.#ready = capabilities.handwriting && (await this.#answersARead());
        return this.#ready;
      }
      if (Date.now() + this.#timing.pollMs > deadline) return false;
      await pause(this.#timing.pollMs);
    }
  }

  transcribe(strokes: readonly Stroke[], options: TranscribeOptions = {}): Promise<string | null> {
    if (strokes.length === 0) return Promise.resolve(null);
    return this.#queue.run(
      async () => asWriting(await this.#read(strokes, options.signal)),
      options.signal,
    );
  }

  async #answersARead(): Promise<boolean> {
    try {
      await this.#post(HI_STROKES);
      return true;
    } catch {
      return false;
    }
  }

  async #read(strokes: readonly Stroke[], signal?: AbortSignal): Promise<string | null> {
    try {
      return await this.#post(strokes, signal);
    } catch {
      return null;
    }
  }

  async #post(strokes: readonly Stroke[], signal?: AbortSignal): Promise<string | null> {
    const timeout = AbortSignal.timeout(this.#timing.requestTimeoutMs);
    const answer = await this.#fetch(sidecarUrl(this.#endpoint.url, "read"), {
      method: "POST",
      headers: endpointHeaders(this.#endpoint, { "content-type": "application/json" }),
      body: JSON.stringify({ strokes }),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    if (!answer.ok) throw new Error(`the sidecar answered ${answer.status}`);
    return readSchema.parse(await answer.json()).text;
  }
}
