const CAT_RATE = 0.92;
const CAT_PITCH = 0.75;
const SILENT_PRIMER = " ";

export interface CatVoice {
  readonly muted: boolean;
  speak(line: string): void;
  setMuted(muted: boolean): void;
}

export type UtteranceFactory = (line: string) => SpeechSynthesisUtterance;

export class SpeechCatVoice implements CatVoice {
  private readonly synth: SpeechSynthesis;
  private readonly createUtterance: UtteranceFactory;
  private isMuted = false;

  constructor(synth: SpeechSynthesis, createUtterance: UtteranceFactory) {
    this.synth = synth;
    this.createUtterance = createUtterance;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  speak(line: string): void {
    if (this.isMuted) return;
    this.synth.cancel();
    const utterance = this.createUtterance(line);
    utterance.rate = CAT_RATE;
    utterance.pitch = CAT_PITCH;
    this.synth.speak(utterance);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) this.synth.cancel();
  }

  /** iOS Safari only lets a page speak after an utterance has been started from inside a user gesture. */
  unlockOnFirstGesture(target: Document): void {
    const prime = (): void => {
      const primer = this.createUtterance(SILENT_PRIMER);
      primer.volume = 0;
      this.synth.speak(primer);
    };
    target.addEventListener("pointerdown", prime, { once: true, capture: true });
  }
}

class SilentCatVoice implements CatVoice {
  private isMuted = false;

  get muted(): boolean {
    return this.isMuted;
  }

  speak(): void {}

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }
}

export const createCatVoice = (host: Window): CatVoice => {
  if (!("speechSynthesis" in host) || !("SpeechSynthesisUtterance" in host)) {
    return new SilentCatVoice();
  }
  const voice = new SpeechCatVoice(
    host.speechSynthesis,
    (line) => new SpeechSynthesisUtterance(line),
  );
  voice.unlockOnFirstGesture(host.document);
  return voice;
};
