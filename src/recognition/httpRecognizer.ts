import type { Stroke } from "../core/geometry";
import type { Drawing } from "../ink/types";
import { sightingsOf } from "./sightings";
import type { LiveRecognizer, Sighting, SightOptions } from "./types";

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

export class HttpRecognizer implements LiveRecognizer {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async recognize(drawing: Drawing): Promise<readonly string[]> {
    const body = await this.#ask({ strokes: drawing.strokes });
    return isGuessList(body) ? body.guesses : [];
  }

  async sight(
    strokes: readonly Stroke[],
    { partial = false }: SightOptions = {},
  ): Promise<readonly Sighting[]> {
    return sightingsOf(await this.#ask(partial ? { strokes, partial } : { strokes }));
  }

  async #ask(request: object): Promise<unknown> {
    try {
      const response = await this.#fetch(RECOGNIZE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
}
