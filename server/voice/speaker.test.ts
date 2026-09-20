// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../llm/chatClient";
import { DeepgramSpeaker } from "./speaker";
import { SpeechCache } from "./speechCache";
import type { VoiceConfig } from "./types";

const CONFIG: VoiceConfig = {
  apiKey: "not-a-real-key",
  listenModel: "nova-3",
  speakModel: "aura-2-draco-en",
};

interface SeenRequest {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly text: unknown;
}

const deepgramSaying = (audio: Uint8Array, seen: SeenRequest[] = []): FetchLike =>
  async function speak(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      authorization: headers.get("authorization") ?? undefined,
      text: (JSON.parse(String(init?.body)) as { text: unknown }).text,
    });
    return new Response(audio.slice().buffer, { headers: { "content-type": "audio/mpeg" } });
  };

const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

describe("DeepgramSpeaker", () => {
  it("asks aura for the line, with the key in a header", async () => {
    const seen: SeenRequest[] = [];
    const speaker = new DeepgramSpeaker(CONFIG, deepgramSaying(mp3, seen));
    const spoken = await speaker.speak("  And what is that supposed to be?  ");
    expect(new Uint8Array(spoken ?? new ArrayBuffer(0))).toEqual(mp3);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("api.deepgram.com/v1/speak");
    expect(seen[0]?.authorization).toBe("Token not-a-real-key");
    expect(seen[0]?.text).toBe("And what is that supposed to be?");
  });

  it("says a repeated line without asking again", async () => {
    const seen: SeenRequest[] = [];
    const speaker = new DeepgramSpeaker(CONFIG, deepgramSaying(mp3, seen));
    await speaker.speak("Curiouser.");
    await speaker.speak("Curiouser.");
    expect(seen).toHaveLength(1);
  });

  it("stays quiet on an empty line, an error and a refusal", async () => {
    const speaker = new DeepgramSpeaker(CONFIG, deepgramSaying(mp3));
    expect(await speaker.speak("   ")).toBeNull();

    const refused = new DeepgramSpeaker(CONFIG, async () => new Response("no", { status: 401 }));
    expect(await refused.speak("Curiouser.")).toBeNull();

    const broken = new DeepgramSpeaker(CONFIG, () => Promise.reject(new Error("offline")));
    expect(await broken.speak("Curiouser.")).toBeNull();
  });
});

describe("SpeechCache", () => {
  const audio = (bytes: number): ArrayBuffer => new ArrayBuffer(bytes);

  it("keeps lines until the budget runs out, oldest first", () => {
    const cache = new SpeechCache(100);
    cache.keep("one", audio(60));
    cache.keep("two", audio(60));
    expect(cache.get("one")).toBeNull();
    expect(cache.get("two")).not.toBeNull();
  });

  it("keeps a line that is asked for again", () => {
    const cache = new SpeechCache(100);
    cache.keep("one", audio(40));
    cache.keep("two", audio(40));
    cache.get("one");
    cache.keep("three", audio(40));
    expect(cache.get("one")).not.toBeNull();
    expect(cache.get("two")).toBeNull();
  });

  it("refuses a line larger than the whole budget", () => {
    const cache = new SpeechCache(100);
    cache.keep("huge", audio(200));
    expect(cache.size).toBe(0);
  });
});
