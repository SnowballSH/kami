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

export interface ListenOptions {
  /** A standing stream of utterances to watch for the wake word, rather than one held press. */
  readonly wake: boolean;
}

export type DialVoice = (
  sampleRate: number,
  handlers: SocketHandlers,
  options: ListenOptions,
) => VoiceSocket;

/** Runs `todo` after `ms`; the browser's `setTimeout`, and something instant in tests. */
export type Schedule = (todo: () => void, ms: number) => void;

export interface EarsHandlers {
  /** The words so far, while the player is still holding the button. */
  onHearing(text: string): void;
  /** The whole utterance; empty when nothing was made out. */
  onHeard(text: string): void;
  onListeningChanged(listening: boolean): void;
  /** The microphone is open waiting for "kami" — or it is not, because it could not be. */
  onWakingChanged(waking: boolean): void;
}

/** Hold to talk: `hold` while the button or Space is down, `release` when it comes up. */
export interface Listening {
  hold(): void;
  release(): void;
  /** Or do not hold anything: leave the microphone open and say "kami" first. */
  wake(enabled: boolean): void;
  readonly listening: boolean;
  readonly waking: boolean;
}

export interface Speaking {
  /** Say a line aloud, after any line already speaking; never throws, and stays silent on failure. */
  say(text: string): void;
  hush(): void;
}

export interface Voice extends Listening, Speaking {}
