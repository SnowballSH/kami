import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";
import { ChatClient, type FetchLike, type LlmConfig, lastJsonObject } from "../llm/chatClient";
import { TRANSCRIBER_SYSTEM_PROMPT, TRANSCRIBER_USER_LINE } from "./prompt";
import { strokesToPngDataUrl } from "./strokeImage";

export interface TranscribeOptions {
  /** The player drew on or left: the answer is no longer wanted. */
  readonly signal?: AbortSignal;
}

/** Reads handwriting from pen strokes. `null` means "a drawing, not writing" (or no answer). */
export interface HandwritingTranscriber {
  transcribe(strokes: readonly Stroke[], options?: TranscribeOptions): Promise<string | null>;
  warmUp(): Promise<boolean>;
}

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPLY_TOKENS = 80;
const MAX_TEXT_LENGTH = 80;
const MIN_DISTINCT_LETTERS = 2;
const WARM_UP_STROKES: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
  ],
  [
    { x: 0, y: 20 },
    { x: 20, y: 20 },
  ],
  [
    { x: 20, y: 0 },
    { x: 20, y: 40 },
  ],
];

const replySchema = z.object({ text: z.string().nullable() });

/**
 * A fence reads as "IIIIII" and a box as "O" to a keen model: words have at least two different
 * letters or digits in them, and a whiteboard note fits on a line.
 */
export const readsAsWriting = (text: string): boolean => {
  const letters = new Set(text.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []);
  return text.length > 0 && text.length <= MAX_TEXT_LENGTH && letters.size >= MIN_DISTINCT_LETTERS;
};

export const parseTranscription = (content: string): string | null => {
  const reply = replySchema.safeParse(lastJsonObject(content));
  if (!reply.success || reply.data.text === null) return null;
  const text = reply.data.text.replace(/\s+/g, " ").trim();
  return readsAsWriting(text) ? text : null;
};

export class LlmTranscriber implements HandwritingTranscriber {
  readonly #chat: ChatClient;

  constructor(config: LlmConfig, fetchFn: FetchLike = fetch) {
    this.#chat = new ChatClient(config, fetchFn);
  }

  /** The first image through a vision model loads its image encoder: pay for that at start-up. */
  async warmUp(): Promise<boolean> {
    return (await this.#ask(WARM_UP_STROKES)) !== null;
  }

  async transcribe(
    strokes: readonly Stroke[],
    options: TranscribeOptions = {},
  ): Promise<string | null> {
    if (strokes.length === 0) return null;
    const content = await this.#ask(strokes, options.signal);
    return content === null ? null : parseTranscription(content);
  }

  #ask(strokes: readonly Stroke[], signal?: AbortSignal): Promise<string | null> {
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
      { maxTokens: MAX_REPLY_TOKENS, timeoutMs: REQUEST_TIMEOUT_MS, ...(signal ? { signal } : {}) },
    );
  }
}

export const createLlmTranscriber = (
  config: LlmConfig | null,
  fetchFn?: FetchLike,
): HandwritingTranscriber | null => (config === null ? null : new LlmTranscriber(config, fetchFn));
