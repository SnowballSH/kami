// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hear, listenUrl, speakUrl, tokenProtocol } from "./deepgram";
import { isWaking, sampleRateOf } from "./socket";
import type { VoiceConfig } from "./types";

const CONFIG: VoiceConfig = {
  apiKey: "not-a-real-key",
  listenModel: "nova-3",
  speakModel: "aura-2-draco-en",
};

const results = (transcript: string, isFinal: boolean, speechFinal = false): string =>
  JSON.stringify({
    type: "Results",
    is_final: isFinal,
    speech_final: speechFinal,
    channel: { alternatives: [{ transcript }] },
  });

describe("listenUrl", () => {
  it("describes the microphone Deepgram is about to hear", () => {
    const url = new URL(listenUrl(CONFIG, { sampleRate: 24_000 }));
    expect(url.origin + url.pathname).toBe("wss://api.deepgram.com/v1/listen");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      model: "nova-3",
      encoding: "linear16",
      sample_rate: "24000",
      channels: "1",
      interim_results: "true",
    });
  });
});

describe("speakUrl", () => {
  it("asks aura for mp3", () => {
    const url = new URL(speakUrl(CONFIG));
    expect(url.pathname).toBe("/v1/speak");
    expect(url.searchParams.get("model")).toBe("aura-2-draco-en");
    expect(url.searchParams.get("encoding")).toBe("mp3");
  });
});

describe("tokenProtocol", () => {
  it("carries the key where headers cannot go", () => {
    expect(tokenProtocol(CONFIG)).toEqual(["token", "not-a-real-key"]);
  });
});

describe("hear", () => {
  it("reads interim and final transcripts", () => {
    expect(hear(results("what is", false))).toEqual({
      text: "what is",
      settled: false,
      ended: false,
    });
    expect(hear(results("  what is that?  ", true))).toEqual({
      text: "what is that?",
      settled: true,
      ended: false,
    });
  });

  it("knows when the speaker stopped", () => {
    expect(hear(results("make her fly", true, true))?.ended).toBe(true);
  });

  it("ignores metadata, keep-alives and nonsense", () => {
    expect(hear(JSON.stringify({ type: "Metadata", request_id: "x" }))).toBeNull();
    expect(hear(JSON.stringify({ type: "Results" }))).toBeNull();
    expect(hear("not json")).toBeNull();
    expect(hear("")).toBeNull();
  });
});

describe("isWaking", () => {
  it("tells a standing wake-word stream from one press", () => {
    expect(isWaking("ws://kami.test/api/voice/listen?rate=48000&wake=1")).toBe(true);
    expect(isWaking("ws://kami.test/api/voice/listen?rate=48000")).toBe(false);
  });
});

describe("sampleRateOf", () => {
  it("takes the browser's capture rate, within reason", () => {
    expect(sampleRateOf("ws://kami.test/api/voice/listen?rate=48000")).toBe(48_000);
    expect(sampleRateOf("ws://kami.test/api/voice/listen?rate=44100")).toBe(44_100);
  });

  it("falls back when the rate is missing or absurd", () => {
    expect(sampleRateOf("ws://kami.test/api/voice/listen")).toBe(16_000);
    expect(sampleRateOf("ws://kami.test/api/voice/listen?rate=7")).toBe(16_000);
    expect(sampleRateOf("ws://kami.test/api/voice/listen?rate=nonsense")).toBe(16_000);
  });
});
