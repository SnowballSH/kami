import { CLOSE_STREAM, hear, isUtteranceEnd } from "./deepgram";
import { Hearing } from "./hearing";
import type { VoiceMessage } from "./types";

/** The browser's end of the voice socket. */
export interface Listener {
  tell(message: VoiceMessage): void;
  close(): void;
}

/** Deepgram's end. `open`, `message` and `closed` are called by whoever dials it. */
export interface Ear {
  send(audio: Uint8Array<ArrayBuffer> | string): void;
  close(): void;
}

export interface EarHandlers {
  opened(): void;
  message(raw: string): void;
  closed(): void;
  failed(): void;
}

export type DialEar = (handlers: EarHandlers) => Ear;

/**
 * One press of hold-to-talk. Audio arrives before Deepgram has answered the phone, so it is held
 * until then; the release tells Deepgram there is no more, and the last words it sends back are
 * the utterance. Every failure ends the same way: one empty `heard`, and the game plays on.
 *
 * Listening for the wake word instead (`continuous`), the stream outlives each utterance: every
 * time the speaker stops, what they said is sent on and the next utterance starts clean.
 */
export class VoiceRelay {
  readonly #listener: Listener;
  readonly #hearing = new Hearing();
  readonly #queued: Uint8Array<ArrayBuffer>[] = [];
  #ear: Ear | null = null;
  #open = false;
  #done = false;
  #finished = false;
  readonly #continuous: boolean;

  constructor(listener: Listener, dial: DialEar, { continuous = false } = {}) {
    this.#listener = listener;
    this.#continuous = continuous;
    this.#ear = dial({
      opened: () => this.#opened(),
      message: (raw) => this.#heard(raw),
      closed: () => this.#finish(),
      failed: () => this.#trouble(),
    });
  }

  audio(frame: Uint8Array<ArrayBufferLike>): void {
    if (this.#done) return;
    const copy = new Uint8Array(frame);
    if (this.#open) this.#ear?.send(copy);
    else this.#queued.push(copy);
  }

  /** The player let go of the button. */
  done(): void {
    if (this.#done) return;
    this.#done = true;
    if (this.#ear === null) this.#finish();
    else if (this.#open) this.#ear.send(CLOSE_STREAM);
  }

  /** The browser hung up, or the page went away. */
  abandon(): void {
    this.#done = true;
    this.#finished = true;
    this.#ear?.close();
    this.#ear = null;
  }

  #opened(): void {
    this.#open = true;
    this.#listener.tell({ type: "listening" });
    for (const frame of this.#queued) this.#ear?.send(frame);
    this.#queued.length = 0;
    if (this.#done) this.#ear?.send(CLOSE_STREAM);
  }

  #heard(raw: string): void {
    if (this.#continuous && isUtteranceEnd(raw)) {
      this.#utterance();
      return;
    }
    const heard = hear(raw);
    if (heard === null) return;
    if (this.#hearing.take(heard)) {
      this.#listener.tell({ type: "hearing", text: this.#hearing.transcript });
    }
    if (this.#continuous && heard.ended) this.#utterance();
  }

  /** The speaker stopped: hand on what they said, and leave the stream open for the next one. */
  #utterance(): void {
    const utterance = this.#hearing.settledTranscript;
    this.#hearing.reset();
    if (utterance !== "") this.#listener.tell({ type: "heard", text: utterance });
  }

  #trouble(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#listener.tell({ type: "trouble" });
    this.#listener.close();
  }

  #finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#ear?.close();
    this.#ear = null;
    this.#listener.tell({ type: "heard", text: this.#hearing.settledTranscript });
    this.#listener.close();
  }
}
