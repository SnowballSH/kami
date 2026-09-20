import { DONE, readVoiceMessage } from "./messages";
import type {
  DialVoice,
  EarsHandlers,
  Listening,
  Microphone,
  MicrophoneSession,
  Schedule,
  VoiceSocket,
} from "./types";
import { WakeWord } from "./wakeWord";

/** Deepgram drops a stream it has nothing to say about; waking listens again shortly after. */
const REOPEN_MS = 1_500;

type Mode = "press" | "wake" | null;

/**
 * The two ways of talking to Kami, over one microphone. Holding the button is a press: the
 * microphone opens, and the words spoken before it comes up are the utterance. Waking is a
 * standing stream instead, where nothing counts until his name is said (`docs/voice.md`).
 *
 * Opening the microphone and the socket takes a moment, so a press let go before either is ready
 * still sends what was captured; a failure anywhere ends the listening and leaves the game as it
 * was.
 */
export class Ears implements Listening {
  readonly #microphone: Microphone;
  readonly #dial: DialVoice;
  readonly #handlers: EarsHandlers;
  readonly #later: Schedule;
  readonly #waiting: Uint8Array<ArrayBuffer>[] = [];
  readonly #wake = new WakeWord();
  #session: MicrophoneSession | null = null;
  #socket: VoiceSocket | null = null;
  #mode: Mode = null;
  #generation = 0;
  #open = false;
  #held = false;
  #wanted = false;

  constructor(
    microphone: Microphone,
    dial: DialVoice,
    handlers: EarsHandlers,
    later: Schedule = (todo, ms) => void setTimeout(todo, ms),
  ) {
    this.#microphone = microphone;
    this.#dial = dial;
    this.#handlers = handlers;
    this.#later = later;
  }

  get listening(): boolean {
    return this.#held || this.#wake.armed;
  }

  get waking(): boolean {
    return this.#wanted;
  }

  hold(): void {
    if (this.#held) return;
    this.#end();
    this.#held = true;
    this.#handlers.onListeningChanged(true);
    this.#begin("press");
  }

  release(): void {
    if (!this.#held) return;
    this.#held = false;
    this.#handlers.onListeningChanged(this.listening);
    if (this.#mode !== "press") return;
    void this.#session?.close();
    this.#session = null;
    if (this.#socket === null) this.#end({ resume: true });
    else if (this.#open) this.#socket.send(DONE);
  }

  wake(enabled: boolean): void {
    if (enabled === this.#wanted) return;
    this.#wanted = enabled;
    this.#handlers.onWakingChanged(enabled);
    if (!enabled) {
      if (this.#mode === "wake") this.#end();
      return;
    }
    if (!this.#held && this.#mode === null) this.#begin("wake");
  }

  cancel(): void {
    this.wake(false);
    this.#end();
  }

  #begin(mode: Exclude<Mode, null>): void {
    this.#mode = mode;
    void this.#listen(mode, this.#generation);
  }

  async #listen(mode: Exclude<Mode, null>, generation: number): Promise<void> {
    const session = await this.#microphone.open((frame) => {
      if (this.#current(generation)) this.#capture(frame);
    });
    if (!this.#current(generation)) {
      void session?.close();
      return;
    }
    if (session === null) {
      this.#unheard();
      return;
    }
    this.#session = session;
    this.#socket = this.#dial(
      session.sampleRate,
      {
        opened: () => {
          if (this.#current(generation)) this.#opened();
        },
        message: (raw) => {
          if (this.#current(generation)) this.#say(raw, mode);
        },
        closed: () => {
          if (this.#current(generation)) this.#closed(mode);
        },
      },
      { wake: mode === "wake" },
    );
  }

  /**
   * A socket this listening still owns. One closed on the way to the next one goes on shouting
   * for a while, and what it has to say is about a microphone nobody is holding any more.
   */
  #current(generation: number): boolean {
    return generation === this.#generation;
  }

  #capture(frame: Uint8Array<ArrayBuffer>): void {
    if (this.#socket !== null && this.#open) this.#socket.send(frame);
    else this.#waiting.push(frame);
  }

  #opened(): void {
    this.#open = true;
    for (const frame of this.#waiting) this.#socket?.send(frame);
    this.#waiting.length = 0;
    if (this.#mode === "press" && !this.#held) this.#socket?.send(DONE);
  }

  #say(raw: string, mode: Exclude<Mode, null>): void {
    const message = readVoiceMessage(raw);
    if (message === null) return;
    switch (message.type) {
      case "hearing":
        if (mode === "press") this.#handlers.onHearing(message.text);
        return;
      case "heard":
        if (mode === "press") this.#pressHeard(message.text);
        else this.#wakeHeard(message.text);
        return;
      case "listening":
      case "trouble":
        return;
    }
  }

  #pressHeard(text: string): void {
    this.#end({ resume: true });
    if (text !== "") this.#handlers.onHeard(text);
  }

  #wakeHeard(text: string): void {
    const was = this.listening;
    const command = this.#wake.heard(text);
    if (this.listening !== was) this.#handlers.onListeningChanged(this.listening);
    if (command !== null) this.#handlers.onHeard(command);
  }

  #closed(mode: Exclude<Mode, null>): void {
    if (mode === "press") {
      this.#end({ resume: true });
      return;
    }
    this.#end();
    if (this.#wanted && !this.#held) this.#later(() => this.#reopen(), REOPEN_MS);
  }

  /** The player refused the microphone, or the browser has none: waking is off, and says so. */
  #unheard(): void {
    const waking = this.#mode === "wake";
    this.#end();
    if (!waking) return;
    this.#wanted = false;
    this.#handlers.onWakingChanged(false);
  }

  #reopen(): void {
    if (!this.#wanted || this.#held || this.#mode !== null) return;
    this.#begin("wake");
  }

  #end({ resume = false } = {}): void {
    const was = this.listening;
    this.#generation += 1;
    this.#socket?.close();
    this.#socket = null;
    this.#open = false;
    this.#waiting.length = 0;
    void this.#session?.close();
    this.#session = null;
    this.#mode = null;
    this.#wake.forget();
    this.#held = false;
    if (was !== this.listening) this.#handlers.onListeningChanged(this.listening);
    if (resume && this.#wanted) this.#begin("wake");
  }
}
