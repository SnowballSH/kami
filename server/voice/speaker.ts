import type { FetchLike } from "../llm/chatClient";
import { authorization, speakUrl } from "./deepgram";
import { SpeechCache } from "./speechCache";
import type { Speaker, VoiceConfig } from "./types";

const REQUEST_TIMEOUT_MS = 8000;
const CACHE_BUDGET_BYTES = 8 * 1024 * 1024;

export class DeepgramSpeaker implements Speaker {
  readonly #config: VoiceConfig;
  readonly #fetch: FetchLike;
  readonly #cache = new SpeechCache(CACHE_BUDGET_BYTES);

  constructor(config: VoiceConfig, fetchFn: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchFn;
  }

  async speak(
    text: string,
    { signal }: { readonly signal?: AbortSignal } = {},
  ): Promise<ArrayBuffer | null> {
    const line = text.trim();
    if (line === "") return null;
    const known = this.#cache.get(line);
    if (known !== null) return known;

    const audio = await this.#ask(line, signal);
    if (audio !== null) this.#cache.keep(line, audio);
    return audio;
  }

  async #ask(line: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      const response = await this.#fetch(speakUrl(this.#config), {
        method: "POST",
        headers: { authorization: authorization(this.#config), "content-type": "application/json" },
        body: JSON.stringify({ text: line }),
        signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      });
      if (!response.ok) return null;
      const audio = await response.arrayBuffer();
      return audio.byteLength > 0 ? audio : null;
    } catch {
      return null;
    }
  }
}

export const createSpeaker = (
  config: VoiceConfig | null,
  fetchFn: FetchLike = fetch,
): Speaker | null => (config === null ? null : new DeepgramSpeaker(config, fetchFn));
