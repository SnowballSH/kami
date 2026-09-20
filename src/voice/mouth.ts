import { type FetchLike, JSON_HEADERS } from "../persistence/api";
import { speakPath } from "./api";
import type { Speaking } from "./types";

export interface AudioSink {
  play(mp3: ArrayBuffer): Promise<void>;
  stop(): void;
}

const REQUEST_TIMEOUT_MS = 8000;
/** Lines queue up; a backlog means Kami is behind his own captions, so the oldest are dropped. */
const MAX_QUEUED = 3;

/**
 * Kami's voice, trailing his handwriting. Captions are the truth on screen (`docs/spec.md`);
 * speech is additive, so every failure here is silent and the game never waits for it.
 */
export class Mouth implements Speaking {
  readonly #fetch: FetchLike;
  readonly #sink: AudioSink;
  readonly #queue: string[] = [];
  #speaking = false;
  #generation = 0;
  #request: AbortController | null = null;

  constructor(sink: AudioSink, fetchFn: FetchLike) {
    this.#sink = sink;
    this.#fetch = fetchFn;
  }

  say(text: string): void {
    const line = text.trim();
    if (line === "") return;
    this.#queue.push(line);
    while (this.#queue.length > MAX_QUEUED) this.#queue.shift();
    if (!this.#speaking) void this.#speakOn();
  }

  hush(): void {
    this.#generation += 1;
    this.#request?.abort();
    this.#request = null;
    this.#speaking = false;
    this.#queue.length = 0;
    this.#sink.stop();
  }

  async #speakOn(): Promise<void> {
    const generation = this.#generation;
    this.#speaking = true;
    for (let line = this.#queue.shift(); line !== undefined; line = this.#queue.shift()) {
      const request = new AbortController();
      this.#request = request;
      const mp3 = await this.#ask(line, request.signal);
      if (generation !== this.#generation) return;
      this.#request = null;
      if (mp3 === null) continue;
      try {
        await this.#sink.play(mp3);
      } catch {}
      if (generation !== this.#generation) return;
    }
    this.#speaking = false;
  }

  async #ask(line: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
    try {
      const response = await this.#fetch(speakPath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ text: line }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok) return null;
      const mp3 = await response.arrayBuffer();
      return mp3.byteLength > 0 ? mp3 : null;
    } catch {
      return null;
    }
  }
}

/** Plays one line at a time through an `<audio>` element, and forgets the blob afterwards. */
export class ElementAudioSink implements AudioSink {
  readonly #audio: HTMLAudioElement;
  #finish: (() => void) | null = null;

  constructor(audio: HTMLAudioElement = new Audio()) {
    this.#audio = audio;
  }

  play(mp3: ArrayBuffer): Promise<void> {
    this.stop();
    const url = URL.createObjectURL(new Blob([mp3], { type: "audio/mpeg" }));
    this.#audio.src = url;
    return new Promise<void>((resolve) => {
      const done = (): void => {
        if (this.#finish !== done) return;
        this.#finish = null;
        this.#audio.removeEventListener("ended", done);
        this.#audio.removeEventListener("error", done);
        URL.revokeObjectURL(url);
        this.#audio.removeAttribute("src");
        resolve();
      };
      this.#finish = done;
      this.#audio.addEventListener("ended", done);
      this.#audio.addEventListener("error", done);
      void this.#audio.play().catch(done);
    });
  }

  stop(): void {
    this.#audio.pause();
    this.#finish?.();
  }
}
