/** Deepgram, both ways: the player's voice in (nova-3), Kami's voice out (aura-2). */
export interface VoiceConfig {
  readonly apiKey: string;
  readonly listenModel: string;
  readonly speakModel: string;
}

/** What the player's microphone sounds like; the browser reports its own capture rate. */
export interface AudioFormat {
  readonly sampleRate: number;
}

/** Everything the server says down the voice socket. */
export type VoiceMessage =
  | { readonly type: "listening" }
  /** The words so far, while the player is still talking. */
  | { readonly type: "hearing"; readonly text: string }
  /** The whole utterance, once they stop. Empty text means nothing was said. */
  | { readonly type: "heard"; readonly text: string }
  | { readonly type: "trouble" };

/** Everything the browser sends: audio frames as binary, and this when the button comes up. */
export interface DoneMessage {
  readonly type: "done";
}

export interface Speaker {
  /** MP3 of Kami saying `text`, or null when Deepgram will not answer. */
  speak(text: string, options?: { readonly signal?: AbortSignal }): Promise<ArrayBuffer | null>;
}
