import { z } from "zod";
import type { CompiledRule, RuleCompiler } from "../../src/rules/types";
import { ChatClient, type FetchLike, type LlmConfig, lastJsonObject } from "../llm/chatClient";
import { strictJsonSchema } from "../llm/strictJsonSchema";
import { rawRuleEffectSchema } from "../schemas";
import { clampEffect, describeEffect } from "./effectRanges";
import { COMPILER_SYSTEM_PROMPT } from "./prompt";

export { chatCompletionsUrl, type FetchLike, type LlmConfig } from "../llm/chatClient";

const REQUEST_TIMEOUT_MS = 30_000;
const WARM_UP_TIMEOUT_MS = 120_000;
const MAX_REPLY_TOKENS = 1500;
const WARM_UP_LINE = "hello";
const MAX_EXPLANATION_LENGTH = 80;

const replySchema = z.object({
  effect: rawRuleEffectSchema.nullable(),
  explanation: z.string().nullish(),
});
const replyJsonSchema = strictJsonSchema(replySchema);

const parseModelReply = (content: string): CompiledRule | null => {
  const reply = replySchema.safeParse(lastJsonObject(content));
  if (!reply.success || reply.data.effect === null) return null;
  const effect = clampEffect(reply.data.effect);
  const explanation = reply.data.explanation?.trim().slice(0, MAX_EXPLANATION_LENGTH);
  return { effect, explanation: explanation || describeEffect(effect) };
};

export class LlmRuleCompiler implements RuleCompiler {
  readonly #chat: ChatClient;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#chat = new ChatClient(config, fetchFn);
  }

  async warmUp(): Promise<boolean> {
    return (await this.#ask(WARM_UP_LINE, WARM_UP_TIMEOUT_MS)) !== null;
  }

  async compile(text: string): Promise<CompiledRule | null> {
    const content = await this.#ask(text);
    return content === null ? null : parseModelReply(content);
  }

  #ask(text: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string | null> {
    return this.#chat.ask(
      [
        { role: "system", content: COMPILER_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      { maxTokens: MAX_REPLY_TOKENS, timeoutMs, jsonSchema: replyJsonSchema },
    );
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
