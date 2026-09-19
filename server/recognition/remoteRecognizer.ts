/** Asks the Kami's Eye sidecar (ml/sidecar.py) what a sketch is; any failure is a null, never a throw. */
import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";
import { sidecarUrl } from "./sidecarUrl";
import type { FetchLike, Ranking, RankOptions, UnreliableSketchRanker } from "./types";

export const PARTIAL_TIMEOUT_MS = 150;
export const FINISHED_TIMEOUT_MS = 400;
export const REQUESTED_GUESSES = 5;

const recognitionSchema = z
  .object({
    labels: z.array(z.string().min(1)),
    probs: z.array(z.number().nonnegative()),
  })
  .refine(({ labels, probs }) => labels.length === probs.length);

export class RemoteSketchRecognizer implements UnreliableSketchRanker {
  readonly #url: string;
  readonly #fetch: FetchLike;

  constructor(baseUrl: string, fetchFn: FetchLike = fetch) {
    this.#url = sidecarUrl(baseUrl, "recognize");
    this.#fetch = fetchFn;
  }

  async rank(strokes: readonly Stroke[], options: RankOptions = {}): Promise<Ranking | null> {
    const partial = options.partial ?? false;
    try {
      const answer = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strokes, partial, top: REQUESTED_GUESSES }),
        signal: AbortSignal.timeout(partial ? PARTIAL_TIMEOUT_MS : FINISHED_TIMEOUT_MS),
      });
      if (!answer.ok) return null;
      const recognition = recognitionSchema.safeParse(await answer.json());
      if (!recognition.success) return null;
      const { labels, probs } = recognition.data;
      return labels.map((category, index) => ({
        category,
        confidence: Math.min(1, probs[index] ?? 0),
      }));
    } catch {
      return null;
    }
  }
}
