import { describe, expect, it, vi } from "vitest";
import { createCatVoice, SpeechCatVoice } from "./catVoice";

const createSynth = () => ({ speak: vi.fn(), cancel: vi.fn() });

const createVoice = (synth: ReturnType<typeof createSynth>): SpeechCatVoice =>
  new SpeechCatVoice(
    synth as unknown as SpeechSynthesis,
    (text) => ({ text, rate: 1, pitch: 1, volume: 1 }) as SpeechSynthesisUtterance,
  );

describe("SpeechCatVoice", () => {
  it("cuts off the previous line before speaking the next", () => {
    const synth = createSynth();
    const voice = createVoice(synth);

    voice.speak("Ask, if you like.");
    voice.speak("Curiouser and curiouser.");

    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak.mock.calls.map(([utterance]) => utterance.text)).toEqual([
      "Ask, if you like.",
      "Curiouser and curiouser.",
    ]);
  });

  it("falls silent at once when muted", () => {
    const synth = createSynth();
    const voice = createVoice(synth);

    voice.setMuted(true);
    voice.speak("Unheard.");

    expect(voice.muted).toBe(true);
    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

describe("createCatVoice", () => {
  it("is a safe no-op where the device cannot speak", () => {
    const voice = createCatVoice(window);

    expect(() => voice.speak("Nobody hears this.")).not.toThrow();
  });
});
