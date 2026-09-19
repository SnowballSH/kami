import type { Stroke } from "../../src/core/geometry";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BeautifyRequest {
  readonly strokes: readonly Stroke[];
  /** What the player called it; without one the model goes by what it sees. */
  readonly name?: string;
}

/**
 * Turns a rough sketch into a better drawing of the same thing. The model lives in its own
 * process (KAMI_BEAUTIFY_URL); this only carries the request there and the answer back, whatever
 * its form — `application/json` {strokes} to be drawn with the pen, or an image.
 */
export interface Beautifier {
  /** Null when no model is attached or it did not answer in time. */
  beautify(request: BeautifyRequest): Promise<Response | null>;
}

const BEAUTIFY_TIMEOUT_MS = 20_000;
const PASSED_THROUGH = ["content-type", "content-length"] as const;

class RemoteBeautifier implements Beautifier {
  readonly #url: string;
  readonly #fetch: FetchLike;

  constructor(url: string, fetchFn: FetchLike) {
    this.#url = url;
    this.#fetch = fetchFn;
  }

  async beautify(request: BeautifyRequest): Promise<Response | null> {
    try {
      const answer = await this.#fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(BEAUTIFY_TIMEOUT_MS),
      });
      if (!answer.ok) return null;
      const headers = new Headers();
      for (const name of PASSED_THROUGH) {
        const value = answer.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      return new Response(answer.body, { headers });
    } catch {
      return null;
    }
  }
}

const NO_BEAUTIFIER: Beautifier = { beautify: async () => null };

export const createBeautifier = (url: string | null, fetchFn: FetchLike = fetch): Beautifier =>
  url === null ? NO_BEAUTIFIER : new RemoteBeautifier(url, fetchFn);
