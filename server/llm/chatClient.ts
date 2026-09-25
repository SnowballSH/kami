import { z } from "zod";
import { DEFAULT_REQUEST_SHAPE, degradeAfterRejection, type RequestShape } from "./requestShape";

export {
  parseReasoningEffort,
  REASONING_EFFORTS,
  type ReasoningEffort,
  type RequestShape,
} from "./requestShape";

import type { ReasoningEffort } from "./requestShape";

export interface LlmConfig {
  readonly url: string;
  readonly model: string;
  readonly apiKey?: string;
  /** What to ask for as `reasoning_effort`; `null` never sends the field. Unset means `none`. */
  readonly reasoningEffort?: ReasoningEffort | null;
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
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";
const REJECTED_REQUEST = 400;
const REASONING_BLOCK = /<think>[\s\S]*?(<\/think>|$)/gi;
const JSON_MENTION = /json/i;
const JSON_REMINDER: ChatMessage = { role: "system", content: "Reply with a JSON object." };

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
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

const responseFormatOf = (
  { responseFormat }: RequestShape,
  jsonSchema: AskOptions["jsonSchema"],
): Readonly<Record<string, unknown>> => {
  if (responseFormat === "none") return {};
  if (responseFormat === "json_schema" && jsonSchema !== undefined) {
    return {
      response_format: {
        type: "json_schema",
        json_schema: { name: "reply", strict: true, schema: jsonSchema },
      },
    };
  }
  return { response_format: { type: "json_object" } };
};

const textOf = ({ content }: ChatMessage): string =>
  typeof content === "string"
    ? content
    : content.map((part) => (part.type === "text" ? part.text : "")).join(" ");

/** OpenAI refuses `json_object` mode unless some message says "JSON". */
const mentioningJson = (messages: readonly ChatMessage[]): readonly ChatMessage[] =>
  messages.some((message) => JSON_MENTION.test(textOf(message)))
    ? messages
    : [JSON_REMINDER, ...messages];

const isJsonObjectMode = ({ response_format }: Readonly<Record<string, unknown>>): boolean =>
  (response_format as { type?: string } | undefined)?.type === "json_object";

/**
 * One OpenAI-compatible `/v1/chat/completions` endpoint: vLLM, Ollama, llama.cpp, OpenAI itself
 * or a gateway in front of Anthropic. Every failure — timeout, HTTP error, garbage — is `null`.
 *
 * Servers disagree about the optional fields (`response_format`, `reasoning_effort`, `max_tokens`
 * versus `max_completion_tokens`, a non-default `temperature`), and each says so with a 400. The
 * client keeps a request shape, drops one feature per rejection (`requestShape.ts` decides which,
 * reading the error when it names the field) and remembers the shape that worked, so the cost of
 * learning a server is paid once per process, not once per request.
 */
export class ChatClient {
  readonly #config: LlmConfig;
  readonly #fetch: FetchLike;
  readonly #effort: ReasoningEffort | null;
  #shape: RequestShape = DEFAULT_REQUEST_SHAPE;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
    this.#effort =
      config.reasoningEffort === undefined ? DEFAULT_REASONING_EFFORT : config.reasoningEffort;
    if (this.#effort === null) this.#shape = { ...this.#shape, reasoning: false };
  }

  /** The request shape this client has settled on so far. */
  get shape(): RequestShape {
    return this.#shape;
  }

  async ask(messages: readonly ChatMessage[], options: AskOptions): Promise<string | null> {
    try {
      let shape = this.#shape;
      let response = await this.#post(messages, options, shape);
      while (response.status === REJECTED_REQUEST) {
        const next = degradeAfterRejection(shape, await response.text());
        if (next === null) break;
        shape = next;
        response = await this.#post(messages, options, shape);
      }
      this.#shape = shape;
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
    shape: RequestShape,
  ): Promise<Response> {
    const responseFormat = responseFormatOf(shape, jsonSchema);
    return this.#fetch(chatCompletionsUrl(this.#config.url), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({
        model: this.#config.model,
        ...(shape.temperature ? { temperature: 0 } : {}),
        [shape.tokenLimit]: maxTokens,
        ...(shape.reasoning && this.#effort !== null ? { reasoning_effort: this.#effort } : {}),
        ...responseFormat,
        messages: isJsonObjectMode(responseFormat) ? mentioningJson(messages) : messages,
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
