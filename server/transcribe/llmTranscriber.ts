import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";
import { ChatClient, type FetchLike, type LlmConfig, lastJsonObject } from "../llm/chatClient";
import { HI_STROKES } from "./hiStrokes";
import { TRANSCRIBER_SYSTEM_PROMPT, TRANSCRIBER_USER_LINE } from "./prompt";
import { strokesToPngDataUrl } from "./strokeImage";
import { asWriting, type HandwritingTranscriber, type TranscribeOptions } from "./types";

const REQUEST_TIMEOUT_MS = 35_000;
const WARM_UP_TIMEOUT_MS = 120_000;
const MAX_REPLY_TOKENS = 80;

const replySchema = z.object({ text: z.string().nullable() });
const replyJsonSchema = z.toJSONSchema(replySchema);

export const parseTranscription = (content: string): string | null => {
  const reply = replySchema.safeParse(lastJsonObject(content));
  return reply.success ? asWriting(reply.data.text) : null;
};

export class LlmTranscriber implements HandwritingTranscriber {
  readonly #chat: ChatClient;
  #ready = false;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#chat = new ChatClient(config, fetchFn);
  }

  get ready(): boolean {
    return this.#ready;
  }

  async warmUp(): Promise<boolean> {
    this.#ready = false;
    const content = await this.#ask(HI_STROKES, undefined, WARM_UP_TIMEOUT_MS);
    this.#ready = content !== null && parseTranscription(content)?.toLowerCase() === "hi";
    return this.#ready;
  }

  async transcribe(
    strokes: readonly Stroke[],
    options: TranscribeOptions = {},
  ): Promise<string | null> {
    if (strokes.length === 0) return null;
    const content = await this.#ask(strokes, options.signal);
    return content === null ? null : parseTranscription(content);
  }

  #ask(
    strokes: readonly Stroke[],
    signal?: AbortSignal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<string | null> {
    return this.#chat.ask(
      [
        { role: "system", content: TRANSCRIBER_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: strokesToPngDataUrl(strokes) } },
            { type: "text", text: TRANSCRIBER_USER_LINE },
          ],
        },
      ],
      {
        maxTokens: MAX_REPLY_TOKENS,
        timeoutMs,
        jsonSchema: replyJsonSchema,
        ...(signal ? { signal } : {}),
      },
    );
  }
}

export const createLlmTranscriber = (
  config: LlmConfig | null,
  fetchFn?: FetchLike,
): HandwritingTranscriber | null => (config === null ? null : new LlmTranscriber(config, fetchFn));
