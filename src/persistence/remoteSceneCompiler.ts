import { z } from "zod";
import type { Scene, SceneCompiler } from "../rules/types";
import { browserFetch, type FetchLike, JSON_HEADERS, scenePath } from "./api";
import { compiledRuleSchema, textSchema, vecSchema } from "./schemas";

const SCENE_TIMEOUT_MS = 45_000;

const sceneSchema = z.object({
  place: textSchema,
  line: textSchema,
  laws: z.array(compiledRuleSchema),
  props: z.array(z.object({ word: textSchema, at: vecSchema, size: z.number() })),
}) satisfies z.ZodType<Scene>;

const answerSchema = z.object({ scene: sceneSchema });

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
      const answer = answerSchema.safeParse(await response.json());
      return answer.success ? answer.data.scene : null;
    } catch {
      return null;
    }
  }
}
