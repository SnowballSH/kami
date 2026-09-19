import { z } from "zod";
import type { AudioFormat, VoiceConfig } from "./types";

const LISTEN_ORIGIN = "wss://api.deepgram.com/v1/listen";
const SPEAK_ORIGIN = "https://api.deepgram.com/v1/speak";

export const MIN_SAMPLE_RATE = 8000;
export const MAX_SAMPLE_RATE = 48_000;

export const authorization = (config: VoiceConfig): string => `Token ${config.apiKey}`;

/** Deepgram takes the key as a WebSocket subprotocol, where a browser-style client cannot set headers. */
export const tokenProtocol = (config: VoiceConfig): string[] => ["token", config.apiKey];

/** How long Deepgram waits for more words before it calls an utterance finished. */
const ENDPOINTING_MS = 400;

export const listenUrl = (config: VoiceConfig, { sampleRate }: AudioFormat): string => {
  const url = new URL(LISTEN_ORIGIN);
  url.search = new URLSearchParams({
    model: config.listenModel,
    language: "en-US",
    encoding: "linear16",
    sample_rate: String(sampleRate),
    channels: "1",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    endpointing: String(ENDPOINTING_MS),
  }).toString();
  return url.toString();
};

export const speakUrl = (config: VoiceConfig): string => {
  const url = new URL(SPEAK_ORIGIN);
  url.search = new URLSearchParams({ model: config.speakModel, encoding: "mp3" }).toString();
  return url.toString();
};

/** Deepgram's "that is all the audio there is" message; it answers with the last results, then closes. */
export const CLOSE_STREAM = JSON.stringify({ type: "CloseStream" });

const resultsSchema = z.object({
  type: z.literal("Results"),
  is_final: z.boolean().default(false),
  speech_final: z.boolean().default(false),
  channel: z.object({
    alternatives: z.array(z.object({ transcript: z.string() })).min(1),
  }),
});

export interface Heard {
  readonly text: string;
  /** Deepgram will not revise these words: they can be kept and the rest thrown away. */
  readonly settled: boolean;
  /** The speaker stopped: everything settled so far is one whole utterance. */
  readonly ended: boolean;
}

/** A transcript out of a Deepgram message; null for metadata, keep-alives and anything unreadable. */
export const hear = (raw: string): Heard | null => {
  const results = resultsSchema.safeParse(jsonOrNull(raw));
  if (!results.success) return null;
  const text = results.data.channel.alternatives[0]?.transcript.trim() ?? "";
  return { text, settled: results.data.is_final, ended: results.data.speech_final };
};

const jsonOrNull = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};
