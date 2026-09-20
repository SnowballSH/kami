import type { Prop, Scene, SceneCompiler } from "../rules/types";
import { browserFetch, type FetchLike, JSON_HEADERS, scenePath } from "./api";
import { isCompiledRule, isFiniteNumber, isRecord } from "./remoteRuleCompiler";

const SCENE_TIMEOUT_MS = 45_000;

const isProp = (value: unknown): value is Prop =>
  isRecord(value) &&
  typeof value.word === "string" &&
  isRecord(value.at) &&
  isFiniteNumber(value.at.x) &&
  isFiniteNumber(value.at.y) &&
  isFiniteNumber(value.size);

const everyOne = <Item>(value: unknown, isItem: (item: unknown) => item is Item): value is Item[] =>
  Array.isArray(value) && value.every(isItem);

export const isScene = (value: unknown): value is Scene =>
  isRecord(value) &&
  typeof value.place === "string" &&
  typeof value.line === "string" &&
  everyOne(value.laws, isCompiledRule) &&
  everyOne(value.props, isProp);

/** Asks the server's model to make a place the offline atlas does not know. */
export class RemoteSceneCompiler implements SceneCompiler {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async compile(text: string): Promise<Scene | null> {
    try {
      const response = await this.#fetch(scenePath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(SCENE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return isRecord(body) && isScene(body.scene) ? body.scene : null;
    } catch {
      return null;
    }
  }
}
