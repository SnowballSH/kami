import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../persistence/api";
import { type AudioSink, ElementAudioSink, Mouth } from "./mouth";
import { toPcm16 } from "./pcm";

class FakeSink implements AudioSink {
  readonly played: number[] = [];
  stopped = 0;

  async play(mp3: ArrayBuffer): Promise<void> {
    this.played.push(mp3.byteLength);
  }

  stop(): void {
    this.stopped += 1;
  }
}

const deepgramSaying = (bytes: number, asked: string[] = []): FetchLike =>
  async function speak(_url: string, init?: RequestInit): Promise<Response> {
    asked.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response(new Uint8Array(bytes));
  };

describe("Mouth", () => {
  it("speaks a line, once asked", async () => {
    const asked: string[] = [];
    const sink = new FakeSink();
    new Mouth(sink, deepgramSaying(8, asked)).say("  Curiouser.  ");
    await vi.waitFor(() => expect(sink.played).toEqual([8]));
    expect(asked).toEqual(["Curiouser."]);
  });

  it("speaks lines one after another, not over each other", async () => {
    const asked: string[] = [];
    const sink = new FakeSink();
    const mouth = new Mouth(sink, deepgramSaying(4, asked));
    mouth.say("One.");
    mouth.say("Two.");
    await vi.waitFor(() => expect(asked).toEqual(["One.", "Two."]));
  });

  it("ignores empty lines and stays silent when the server will not speak", async () => {
    const sink = new FakeSink();
    const mouth = new Mouth(sink, async () => new Response("no", { status: 501 }));
    mouth.say("   ");
    mouth.say("Curiouser.");
    await vi.waitFor(() => expect(sink.played).toEqual([]));

    const broken = new Mouth(sink, () => Promise.reject(new Error("offline")));
    broken.say("Curiouser.");
    await vi.waitFor(() => expect(sink.played).toEqual([]));
  });

  it("hushes the queue and whatever is playing", () => {
    const sink = new FakeSink();
    const mouth = new Mouth(sink, deepgramSaying(4));
    mouth.hush();
    expect(sink.stopped).toBe(1);
  });

  it("discards a pending reply after hush and immediately permits new speech", async () => {
    const pending = Promise.withResolvers<Response>();
    const sink = new FakeSink();
    const signals: (AbortSignal | null | undefined)[] = [];
    const mouth = new Mouth(sink, async (_url, init) => {
      signals.push(init?.signal);
      return signals.length === 1 ? pending.promise : new Response(new Uint8Array(8));
    });
    mouth.say("Old board.");
    mouth.hush();
    expect(signals[0]?.aborted).toBe(true);
    mouth.say("New board.");
    await vi.waitFor(() => expect(sink.played).toEqual([8]));
    pending.resolve(new Response(new Uint8Array(4)));
    await pending.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sink.played).toEqual([8]);
  });
});

describe("ElementAudioSink", () => {
  afterEach(() => vi.restoreAllMocks());

  it("settles stopped playback, releases its URL, and lets the queue resume", async () => {
    const audio = new Audio();
    const play = vi.spyOn(audio, "play").mockResolvedValue();
    vi.spyOn(audio, "pause").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:speech");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const sink = new ElementAudioSink(audio);
    const mouth = new Mouth(sink, deepgramSaying(4));
    mouth.say("Old board.");
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    mouth.hush();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(audio.hasAttribute("src")).toBe(false);
    mouth.say("New board.");
    mouth.say("Another line.");
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    audio.dispatchEvent(new Event("ended"));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(3));
    audio.dispatchEvent(new Event("ended"));
    expect(revoke).toHaveBeenCalledTimes(3);
  });
});

describe("toPcm16", () => {
  it("writes little-endian signed samples and clips the loud ones", () => {
    const frame = toPcm16(new Float32Array([0, 1, -1, 2, -2]));
    expect(new Int16Array(frame.buffer)).toEqual(new Int16Array([0, 32767, -32767, 32767, -32767]));
  });
});
