import { z } from "zod";
import type { Stroke } from "../core/geometry";
import { INPUT_LIMITS, isInputStrokes } from "../core/inputLimits";
import { readBoundedText } from "../core/readBody";
import { browserFetch, type FetchLike, JSON_HEADERS, transcribePath } from "./api";
import type { Handwriting, HandwritingReader, ReadOptions } from "./types";

const READ_TIMEOUT_MS = 40_000;

const transcriptionSchema = z.object({
  text: z.string().min(1).max(INPUT_LIMITS.text).nullable(),
  unsure: z.boolean().catch(false),
});

const withTimeout = (signal: AbortSignal | undefined): AbortSignal =>
  signal === undefined
    ? AbortSignal.timeout(READ_TIMEOUT_MS)
    : AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);

export class HttpHandwritingReader implements HandwritingReader {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async read(
    strokes: readonly Stroke[],
    { signal, settled = false }: ReadOptions = {},
  ): Promise<Handwriting | null> {
    if (!isInputStrokes(strokes)) return null;
    try {
      const response = await this.#fetch(transcribePath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(settled ? { strokes, settled } : { strokes }),
        signal: withTimeout(signal),
      });
      if (!response.ok) return null;
      const answer = transcriptionSchema.safeParse(
        JSON.parse(await readBoundedText(response, INPUT_LIMITS.textBytes)),
      );
      if (!answer.success || answer.data.text === null) return null;
      return { text: answer.data.text, unsure: answer.data.unsure };
    } catch {
      return null;
    }
  }
}
