import { z } from "zod";
import type { CompiledRule, RuleCompiler } from "../../src/rules/types";
import { ruleEffectSchema } from "../schemas";
import { clampEffect, describeEffect } from "./effectRanges";
import { COMPILER_SYSTEM_PROMPT } from "./prompt";

export interface LlmConfig {
  readonly url: string;
  readonly model: string;
  readonly apiKey?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const API_VERSION_PATH = "/v1";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REPLY_TOKENS = 200;
const MAX_EXPLANATION_LENGTH = 80;

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

const replySchema = z.object({
  effect: ruleEffectSchema.nullable(),
  explanation: z.string().optional(),
});

export const chatCompletionsUrl = (configured: string): string => {
  const base = configured.replace(/\/+$/, "");
  if (base.endsWith(CHAT_COMPLETIONS_PATH)) return base;
  return base.endsWith(API_VERSION_PATH)
    ? `${base}${CHAT_COMPLETIONS_PATH}`
    : `${base}${API_VERSION_PATH}${CHAT_COMPLETIONS_PATH}`;
};

const outermostJsonObject = (content: string): string | null => {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start === -1 || end <= start ? null : content.slice(start, end + 1);
};

const parseModelReply = (content: string): CompiledRule | null => {
  const jsonText = outermostJsonObject(content);
  if (jsonText === null) return null;
  try {
    const reply = replySchema.safeParse(JSON.parse(jsonText));
    if (!reply.success || reply.data.effect === null) return null;
    const effect = clampEffect(reply.data.effect);
    const explanation = reply.data.explanation?.trim().slice(0, MAX_EXPLANATION_LENGTH);
    return { effect, explanation: explanation || describeEffect(effect) };
  } catch {
    return null;
  }
};

export class LlmRuleCompiler implements RuleCompiler {
  readonly #config: LlmConfig;
  readonly #fetch: FetchLike;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  async compile(text: string): Promise<CompiledRule | null> {
    try {
      const response = await this.#fetch(chatCompletionsUrl(this.#config.url), {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({
          model: this.#config.model,
          temperature: 0,
          max_tokens: MAX_REPLY_TOKENS,
          messages: [
            { role: "system", content: COMPILER_SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const chat = chatResponseSchema.safeParse(await response.json());
      const content = chat.success ? chat.data.choices[0]?.message.content : undefined;
      return content === undefined ? null : parseModelReply(content);
    } catch {
      return null;
    }
  }

  #headers(): Record<string, string> {
    const { apiKey } = this.#config;
    return {
      "content-type": "application/json",
      ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
    };
  }
}

const DISABLED_COMPILER: RuleCompiler = { compile: async () => null };

export const createLlmCompiler = (config: LlmConfig | null, fetchFn?: FetchLike): RuleCompiler =>
  config === null ? DISABLED_COMPILER : new LlmRuleCompiler(config, fetchFn);
