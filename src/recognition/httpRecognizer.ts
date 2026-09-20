import type { Stroke } from "../core/geometry";
import type { Drawing } from "../ink/types";
import { completionOf } from "./completion";
import { exemplarOf } from "./exemplar";
import { sightingsOf } from "./sightings";
import type { Completion, Exemplar, LiveRecognizer, Sighting, SightOptions } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RECOGNIZE_PATH = "/api/recognize";
const COMPLETE_PATH = "/api/beautify";
const EXEMPLAR_PATH = "/api/exemplar";
const RECOGNIZE_TIMEOUT_MS = 2500;
const COMPLETE_TIMEOUT_MS = 4000;
const JSON_TYPE = "application/json";

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
    const body = await this.#ask(RECOGNIZE_PATH, { strokes: drawing.strokes });
    return isGuessList(body) ? body.guesses : [];
  }

  async sight(
    strokes: readonly Stroke[],
    { partial = false }: SightOptions = {},
  ): Promise<readonly Sighting[]> {
    const request = partial ? { strokes, partial } : { strokes };
    return sightingsOf(await this.#ask(RECOGNIZE_PATH, request));
  }

  async complete(strokes: readonly Stroke[], name?: string): Promise<Completion | null> {
    const called = name?.trim() ?? "";
    const request = called.length > 0 ? { strokes, name: called } : { strokes };
    return completionOf(await this.#ask(COMPLETE_PATH, request, COMPLETE_TIMEOUT_MS), strokes);
  }

  async exemplar(word: string): Promise<Exemplar | null> {
    const wanted = word.trim();
    if (wanted.length === 0) return null;
    const path = `${EXEMPLAR_PATH}?${new URLSearchParams({ word: wanted })}`;
    return exemplarOf(
      await this.#answer(path, { signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS) }),
    );
  }

  #ask(path: string, request: object, timeoutMs = RECOGNIZE_TIMEOUT_MS): Promise<unknown> {
    return this.#answer(path, {
      method: "POST",
      headers: { "content-type": JSON_TYPE },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async #answer(path: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await this.#fetch(path, init);
      const answersJson = response.headers.get("content-type")?.includes(JSON_TYPE) ?? false;
      return response.ok && answersJson ? await response.json() : null;
    } catch {
      return null;
    }
  }
}
