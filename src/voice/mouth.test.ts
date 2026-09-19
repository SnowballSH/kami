import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../persistence/api";
import { type AudioSink, Mouth } from "./mouth";
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
});

describe("toPcm16", () => {
  it("writes little-endian signed samples and clips the loud ones", () => {
    const frame = toPcm16(new Float32Array([0, 1, -1, 2, -2]));
    expect(new Int16Array(frame.buffer)).toEqual(new Int16Array([0, 32767, -32767, 32767, -32767]));
  });
});
