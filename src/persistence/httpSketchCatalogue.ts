import { browserFetch, exemplarsPath, type FetchLike } from "./api";
import type { SketchCatalogue } from "./types";

const FETCH_TIMEOUT_MS = 10_000;

const isCatalogue = (body: unknown): body is { readonly categories: readonly string[] } =>
  typeof body === "object" &&
  body !== null &&
  "categories" in body &&
  Array.isArray(body.categories) &&
  body.categories.every((category) => typeof category === "string");

export class HttpSketchCatalogue implements SketchCatalogue {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async categories(): Promise<readonly string[]> {
    try {
      const response = await this.#fetch(exemplarsPath(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body: unknown = response.ok ? await response.json() : null;
      return isCatalogue(body) ? body.categories : [];
    } catch {
      return [];
    }
  }
}
