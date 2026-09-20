import type { Stroke } from "../core/geometry";
import { browserFetch, type FetchLike, sketchesPath, sketchPath } from "./api";
import type { SketchLibrary } from "./types";

const FETCH_TIMEOUT_MS = 10_000;

const isPoint = (value: unknown): value is { readonly x: number; readonly y: number } =>
  typeof value === "object" &&
  value !== null &&
  "x" in value &&
  "y" in value &&
  typeof value.x === "number" &&
  typeof value.y === "number";

const isStrokes = (value: unknown): value is readonly Stroke[] =>
  Array.isArray(value) && value.every((stroke) => Array.isArray(stroke) && stroke.every(isPoint));

const isSketch = (body: unknown): body is { readonly strokes: readonly Stroke[] } =>
  typeof body === "object" && body !== null && "strokes" in body && isStrokes(body.strokes);

const isCatalogue = (body: unknown): body is { readonly categories: readonly string[] } =>
  typeof body === "object" &&
  body !== null &&
  "categories" in body &&
  Array.isArray(body.categories) &&
  body.categories.every((category) => typeof category === "string");

export class HttpSketchLibrary implements SketchLibrary {
  readonly #fetch: FetchLike;
  #categories: Promise<readonly string[]> | null = null;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  categories(): Promise<readonly string[]> {
    this.#categories ??= this.get(sketchesPath()).then((body) => {
      const categories = isCatalogue(body) ? body.categories : [];
      if (categories.length === 0) this.#categories = null;
      return categories;
    });
    return this.#categories;
  }

  async sketch(category: string): Promise<readonly Stroke[] | null> {
    const body = await this.get(sketchPath(category));
    return isSketch(body) && body.strokes.length > 0 ? body.strokes : null;
  }

  private async get(path: string): Promise<unknown> {
    try {
      const response = await this.#fetch(path, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }
}
