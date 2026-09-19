import { DONE, readVoiceMessage } from "./messages";
import type {
  DialVoice,
  EarsHandlers,
  Listening,
  Microphone,
  MicrophoneSession,
  VoiceSocket,
} from "./types";

/**
 * Hold-to-talk, one press at a time. Opening the microphone and the socket takes a moment, so a
 * press that is let go before either is ready still sends what was captured and then asks for the
 * transcript; a press that fails anywhere ends listening and leaves the game exactly as it was.
 */
export class Ears implements Listening {
  readonly #microphone: Microphone;
  readonly #dial: DialVoice;
  readonly #handlers: EarsHandlers;
  #session: MicrophoneSession | null = null;
  #socket: VoiceSocket | null = null;
  #open = false;
  #held = false;
  #pressing = false;
  readonly #waiting: Uint8Array<ArrayBuffer>[] = [];

  constructor(microphone: Microphone, dial: DialVoice, handlers: EarsHandlers) {
    this.#microphone = microphone;
    this.#dial = dial;
    this.#handlers = handlers;
  }

  get listening(): boolean {
    return this.#held;
  }

  hold(): void {
    if (this.#held || this.#pressing) return;
    this.#held = true;
    this.#pressing = true;
    this.#handlers.onListeningChanged(true);
    void this.#start();
  }

  release(): void {
    if (!this.#held) return;
    this.#held = false;
    this.#handlers.onListeningChanged(false);
    void this.#session?.close();
    this.#session = null;
    if (this.#socket === null) return;
    if (this.#open) this.#socket.send(DONE);
  }

  async #start(): Promise<void> {
    const session = await this.#microphone.open((frame) => this.#capture(frame));
    this.#pressing = false;
    if (session === null) {
      this.#stop();
      return;
    }
    if (!this.#held) {
      void session.close();
      return;
    }
    this.#session = session;
    this.#socket = this.#dial(session.sampleRate, {
      opened: () => this.#opened(),
      message: (raw) => this.#say(raw),
      closed: () => this.#stop(),
    });
  }

  #capture(frame: Uint8Array<ArrayBuffer>): void {
    if (this.#socket !== null && this.#open) this.#socket.send(frame);
    else this.#waiting.push(frame);
  }

  #opened(): void {
    this.#open = true;
    for (const frame of this.#waiting) this.#socket?.send(frame);
    this.#waiting.length = 0;
    if (!this.#held) this.#socket?.send(DONE);
  }

  #say(raw: string): void {
    const message = readVoiceMessage(raw);
    if (message === null) return;
    switch (message.type) {
      case "hearing":
        this.#handlers.onHearing(message.text);
        return;
      case "heard":
        this.#stop();
        if (message.text !== "") this.#handlers.onHeard(message.text);
        return;
      case "listening":
      case "trouble":
        return;
    }
  }

  #stop(): void {
    this.#socket?.close();
    this.#socket = null;
    this.#open = false;
    this.#waiting.length = 0;
    void this.#session?.close();
    this.#session = null;
    if (this.#held) {
      this.#held = false;
      this.#handlers.onListeningChanged(false);
    }
  }
}
