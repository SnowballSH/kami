import { z } from "zod";

export interface LlmConfig {
  readonly url: string;
  readonly model: string;
  readonly apiKey?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ChatPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

export interface ChatMessage {
  readonly role: "system" | "user";
  readonly content: string | readonly ChatPart[];
}

export interface AskOptions {
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
  /** The caller gave up (the player drew on): stop the model too. */
  readonly signal?: AbortSignal;
}

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const API_VERSION_PATH = "/v1";
const NO_REASONING = { reasoning_effort: "none" } as const;
const responseFormat = (jsonSchema: AskOptions["jsonSchema"]): Readonly<Record<string, unknown>> =>
  jsonSchema === undefined
    ? { type: "json_object" }
    : { type: "json_schema", json_schema: { name: "reply", strict: true, schema: jsonSchema } };
const REJECTED_REQUEST = 400;
const REASONING_BLOCK = /<think>[\s\S]*?(<\/think>|$)/gi;

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
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

export const lastJsonObject = (content: string): unknown => {
  for (const candidate of topLevelObjects(content.replace(REASONING_BLOCK, "")).toReversed()) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
};

const withTimeout = (timeoutMs: number, signal: AbortSignal | undefined): AbortSignal =>
  signal === undefined
    ? AbortSignal.timeout(timeoutMs)
    : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

/**
 * One OpenAI-compatible `/v1/chat/completions` endpoint (vLLM, Ollama). Every failure — timeout,
 * HTTP error, garbage — is `null`. A short answer needs no chain of thought: on the GX10's qwen3.8,
 * asking for none answers in 1.6 s instead of 13.8 s; a server that rejects the field is asked
 * again without it, once, and not asked for it again.
 */
export class ChatClient {
  readonly #config: LlmConfig;
  readonly #fetch: FetchLike;
  #skipsReasoning = true;
  #usesJsonMode = true;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  async ask(messages: readonly ChatMessage[], options: AskOptions): Promise<string | null> {
    try {
      let response = await this.#post(messages, options);
      if (response.status === REJECTED_REQUEST && this.#skipsReasoning) {
        this.#skipsReasoning = false;
        response = await this.#post(messages, options);
      }
      if (response.status === REJECTED_REQUEST && this.#usesJsonMode) {
        this.#usesJsonMode = false;
        response = await this.#post(messages, options);
      }
      if (!response.ok) return null;
      const chat = chatResponseSchema.safeParse(await response.json());
      return chat.success ? (chat.data.choices[0]?.message.content ?? null) : null;
    } catch {
      return null;
    }
  }

  #post(
    messages: readonly ChatMessage[],
    { maxTokens, timeoutMs, jsonSchema, signal }: AskOptions,
  ): Promise<Response> {
    return this.#fetch(chatCompletionsUrl(this.#config.url), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({
        model: this.#config.model,
        temperature: 0,
        max_tokens: maxTokens,
        ...(this.#skipsReasoning ? NO_REASONING : {}),
        ...(this.#usesJsonMode ? { response_format: responseFormat(jsonSchema) } : {}),
        messages,
      }),
      signal: withTimeout(timeoutMs, signal),
    });
  }

  #headers(): Record<string, string> {
    const { apiKey } = this.#config;
    return {
      "content-type": "application/json",
      ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
    };
  }
}
