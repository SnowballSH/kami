/** Asks the Kami's Eye sidecar (ml/sidecar.py) what a sketch is; any failure is a null, never a throw. */
import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";
import { floorFor } from "./certainty";
import { sidecarUrl } from "./sidecarUrl";
import type {
  CertaintyFloors,
  FetchLike,
  RankOptions,
  Reading,
  UnreliableSketchRanker,
} from "./types";

export const PARTIAL_TIMEOUT_MS = 150;
export const FINISHED_TIMEOUT_MS = 400;
export const REQUESTED_GUESSES = 5;

/** Where Kami's Eye's calibrated confidence is right 95 % of the time, until the sidecar says so itself. */
export const DEFAULT_CERTAINTY_FLOORS: CertaintyFloors = { finished: 0.8, partial: 0.9 };

const statedFloorSchema = z.number().min(0).max(1).nullable().optional().catch(undefined);

const recognitionSchema = z
  .object({
    labels: z.array(z.string().min(1)),
    probs: z.array(z.number().nonnegative()),
    certainAbove: statedFloorSchema,
  })
  .refine(({ labels, probs }) => labels.length === probs.length);

export class RemoteSketchRecognizer implements UnreliableSketchRanker {
  readonly #url: string;
  readonly #fetch: FetchLike;
  readonly #floors: CertaintyFloors;

  constructor(
    baseUrl: string,
    fetchFn: FetchLike = fetch,
    floors: CertaintyFloors = DEFAULT_CERTAINTY_FLOORS,
  ) {
    this.#url = sidecarUrl(baseUrl, "recognize");
    this.#fetch = fetchFn;
    this.#floors = floors;
  }

  async read(strokes: readonly Stroke[], options: RankOptions = {}): Promise<Reading | null> {
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
      const { labels, probs, certainAbove } = recognition.data;
      return {
        ranking: labels.map((category, index) => ({
          category,
          confidence: Math.min(1, probs[index] ?? 0),
        })),
        certainAbove:
          certainAbove === undefined ? floorFor(this.#floors, { partial }) : certainAbove,
      };
    } catch {
      return null;
    }
  }
}
