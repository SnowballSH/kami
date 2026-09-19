import type { Drawing } from "../ink/types";
import type { Recognizer } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RECOGNIZE_PATH = "/api/recognize";
const RECOGNIZE_TIMEOUT_MS = 2500;

const browserFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

const isGuessList = (body: unknown): body is { readonly guesses: readonly string[] } =>
  typeof body === "object" &&
  body !== null &&
  "guesses" in body &&
  Array.isArray(body.guesses) &&
  body.guesses.every((guess) => typeof guess === "string");

export class HttpRecognizer implements Recognizer {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async recognize(drawing: Drawing): Promise<readonly string[]> {
    try {
      const response = await this.#fetch(RECOGNIZE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strokes: drawing.strokes }),
        signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
      });
      if (!response.ok) return [];
      const body: unknown = await response.json();
      return isGuessList(body) ? body.guesses : [];
    } catch {
      return [];
    }
  }
}
