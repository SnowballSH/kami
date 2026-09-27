import { z } from "zod";
import { browserFetch, exemplarsPath, type FetchLike } from "./api";
import type { SketchCatalogue } from "./types";

const FETCH_TIMEOUT_MS = 10_000;

const catalogueSchema = z.object({ categories: z.array(z.string()) });

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
      if (!response.ok) return [];
      const answer = catalogueSchema.safeParse(await response.json());
      return answer.success ? answer.data.categories : [];
    } catch {
      return [];
    }
  }
}
