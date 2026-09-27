import { z } from "zod";
import { INPUT_LIMITS } from "../core/inputLimits";
import type { CompileContext, CompiledRule, RuleCompiler } from "../rules/types";
import { browserFetch, compilePath, type FetchLike, JSON_HEADERS } from "./api";
import { compiledRuleSchema } from "./schemas";

const COMPILE_TIMEOUT_MS = 35_000;

const answerSchema = z.object({ rule: compiledRuleSchema });

export class RemoteRuleCompiler implements RuleCompiler {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async compile(text: string, context?: CompileContext): Promise<CompiledRule | null> {
    if (text.length > INPUT_LIMITS.text) return null;
    try {
      const response = await this.#fetch(compilePath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ text, ...context }),
        signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const answer = answerSchema.safeParse(await response.json());
      return answer.success ? answer.data.rule : null;
    } catch {
      return null;
    }
  }
}
