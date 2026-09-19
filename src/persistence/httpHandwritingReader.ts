import type { Stroke } from "../core/geometry";
import { browserFetch, type FetchLike, JSON_HEADERS, transcribePath } from "./api";
import type { HandwritingReader, ReadOptions } from "./types";

const READ_TIMEOUT_MS = 25_000;

const isTranscription = (body: unknown): body is { readonly text: string | null } =>
  typeof body === "object" &&
  body !== null &&
  "text" in body &&
  (typeof body.text === "string" || body.text === null);

const withTimeout = (signal: AbortSignal | undefined): AbortSignal =>
  signal === undefined
    ? AbortSignal.timeout(READ_TIMEOUT_MS)
    : AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);

export class HttpHandwritingReader implements HandwritingReader {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async read(strokes: readonly Stroke[], { signal }: ReadOptions = {}): Promise<string | null> {
    try {
      const response = await this.#fetch(transcribePath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ strokes }),
        signal: withTimeout(signal),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return isTranscription(body) && body.text !== null && body.text.length > 0 ? body.text : null;
    } catch {
      return null;
    }
  }
}
