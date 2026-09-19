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
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REPLY_TOKENS = 1500;
const WARM_UP_LINE = "hello";
const REASONING_BLOCK = /<think>[\s\S]*?(<\/think>|$)/gi;
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

/** Top-level `{…}` spans, ignoring braces inside strings. Models wrap JSON in prose, fences and reasoning. */
const topLevelObjects = (content: string): readonly string[] => {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"' && depth > 0) inString = true;
    else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) spans.push(content.slice(start, i + 1));
    }
  }
  return spans;
};

const lastJsonObject = (content: string): unknown => {
  for (const candidate of topLevelObjects(content.replace(REASONING_BLOCK, "")).toReversed()) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
};

const parseModelReply = (content: string): CompiledRule | null => {
  const reply = replySchema.safeParse(lastJsonObject(content));
  if (!reply.success || reply.data.effect === null) return null;
  const effect = clampEffect(reply.data.effect);
  const explanation = reply.data.explanation?.trim().slice(0, MAX_EXPLANATION_LENGTH);
  return { effect, explanation: explanation || describeEffect(effect) };
};

export class LlmRuleCompiler implements RuleCompiler {
  readonly #config: LlmConfig;
  readonly #fetch: FetchLike;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  /** Loading tens of GB into memory is slow; pay for it at start-up, not on the first player's note. */
  async warmUp(): Promise<boolean> {
    return (await this.#ask(WARM_UP_LINE)) !== null;
  }

  async compile(text: string): Promise<CompiledRule | null> {
    const content = await this.#ask(text);
    return content === null ? null : parseModelReply(content);
  }

  async #ask(text: string): Promise<string | null> {
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
      return chat.success ? (chat.data.choices[0]?.message.content ?? null) : null;
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

export interface WarmableCompiler extends RuleCompiler {
  warmUp(): Promise<boolean>;
}

const DISABLED_COMPILER: WarmableCompiler = {
  compile: async () => null,
  warmUp: async () => false,
};

export const createLlmCompiler = (
  config: LlmConfig | null,
  fetchFn?: FetchLike,
): WarmableCompiler => (config === null ? DISABLED_COMPILER : new LlmRuleCompiler(config, fetchFn));
