import { z } from "zod";
import { clamp, type Stroke } from "../core/geometry";
import { INPUT_LIMITS, isInputStrokes } from "../core/inputLimits";
import { readBoundedText } from "../core/readBody";
import type { Drawing } from "../ink/types";
import {
  beautifyPath,
  browserFetch,
  exemplarPath,
  type FetchLike,
  JSON_HEADERS,
  recognizePath,
} from "../persistence/api";
import { completionOf } from "./completion";
import { exemplarOf } from "./exemplar";
import { sightingsOf } from "./sightings";
import type { Completion, Exemplar, LiveRecognizer, Sighting, SightOptions } from "./types";

const RECOGNIZE_TIMEOUT_MS = 2500;
const COMPLETE_TIMEOUT_MS = 4000;

const guessesSchema = z.object({ guesses: z.array(z.string()) });

export class HttpRecognizer implements LiveRecognizer {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async recognize(drawing: Drawing): Promise<readonly string[]> {
    if (!isInputStrokes(drawing.strokes)) return [];
    const answer = guessesSchema.safeParse(
      await this.#ask(recognizePath(), { strokes: drawing.strokes }),
    );
    return answer.success ? answer.data.guesses : [];
  }

  async sight(
    strokes: readonly Stroke[],
    { partial = false }: SightOptions = {},
  ): Promise<readonly Sighting[]> {
    if (!isInputStrokes(strokes)) return [];
    const request = partial ? { strokes, partial } : { strokes };
    return sightingsOf(await this.#ask(recognizePath(), request));
  }

  async complete(
    strokes: readonly Stroke[],
    name?: string,
    firmness?: number,
  ): Promise<Completion | null> {
    if (!isInputStrokes(strokes)) return null;
    const called = name?.trim() ?? "";
    if (called.length > INPUT_LIMITS.name) return null;
    const request = {
      strokes,
      ...(called.length > 0 ? { name: called } : {}),
      ...(firmness === undefined ? {} : { strength: clamp(firmness, 0, 1) }),
    };
    return completionOf(await this.#ask(beautifyPath(), request, COMPLETE_TIMEOUT_MS), strokes);
  }

  async exemplar(word: string): Promise<Exemplar | null> {
    const wanted = word.trim();
    if (wanted.length === 0) return null;
    return exemplarOf(
      await this.#answer(exemplarPath(wanted), {
        signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
      }),
    );
  }

  #ask(path: string, request: object, timeoutMs = RECOGNIZE_TIMEOUT_MS): Promise<unknown> {
    return this.#answer(path, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async #answer(path: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await this.#fetch(path, init);
      const answersJson =
        response.headers.get("content-type")?.includes(JSON_HEADERS["content-type"]) ?? false;
      return response.ok && answersJson
        ? JSON.parse(await readBoundedText(response, INPUT_LIMITS.sketchBytes))
        : null;
    } catch {
      return null;
    }
  }
}
