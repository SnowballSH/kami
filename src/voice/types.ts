/** What the server says down the voice socket (`server/voice/types.ts`). */
export type VoiceMessage =
  | { readonly type: "listening" }
  | { readonly type: "hearing"; readonly text: string }
  | { readonly type: "heard"; readonly text: string }
  | { readonly type: "trouble" };

export interface MicrophoneSession {
  /** The rate the browser actually captured at; Deepgram is told, rather than resampling here. */
  readonly sampleRate: number;
  close(): Promise<void>;
}

export interface Microphone {
  /** Null when the player refuses the microphone, or the browser has none. */
  open(onAudio: (frame: Uint8Array<ArrayBuffer>) => void): Promise<MicrophoneSession | null>;
}

export interface SocketHandlers {
  opened(): void;
  message(raw: string): void;
  closed(): void;
}

export interface VoiceSocket {
  send(data: Uint8Array<ArrayBuffer> | string): void;
  close(): void;
}

export type DialVoice = (sampleRate: number, handlers: SocketHandlers) => VoiceSocket;

export interface EarsHandlers {
  /** The words so far, while the player is still holding the button. */
  onHearing(text: string): void;
  /** The whole utterance; empty when nothing was made out. */
  onHeard(text: string): void;
  onListeningChanged(listening: boolean): void;
}

/** Hold to talk: `hold` while the button or Space is down, `release` when it comes up. */
export interface Listening {
  hold(): void;
  release(): void;
  readonly listening: boolean;
}

export interface Speaking {
  /** Say a line aloud, after any line already speaking; never throws, and stays silent on failure. */
  say(text: string): void;
  hush(): void;
}

export interface Voice extends Listening, Speaking {}
