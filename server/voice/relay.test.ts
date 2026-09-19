// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type DialEar, type Ear, type EarHandlers, type Listener, VoiceRelay } from "./relay";
import type { VoiceMessage } from "./types";

const results = (transcript: string, isFinal: boolean): string =>
  JSON.stringify({
    type: "Results",
    is_final: isFinal,
    channel: { alternatives: [{ transcript }] },
  });

class FakeEar implements Ear {
  readonly sent: (string | Uint8Array)[] = [];
  closed = false;
  handlers!: EarHandlers;

  readonly dial: DialEar = (handlers) => {
    this.handlers = handlers;
    return this;
  };

  send(audio: Uint8Array<ArrayBuffer> | string): void {
    this.sent.push(audio);
  }

  close(): void {
    this.closed = true;
  }

  get audioFrames(): number {
    return this.sent.filter((message) => typeof message !== "string").length;
  }
}

class FakeListener implements Listener {
  readonly told: VoiceMessage[] = [];
  closed = false;

  tell(message: VoiceMessage): void {
    this.told.push(message);
  }

  close(): void {
    this.closed = true;
  }

  get last(): VoiceMessage | undefined {
    return this.told.at(-1);
  }
}

const frame = (): Uint8Array<ArrayBuffer> => new Uint8Array([1, 2, 3, 4]);

const started = (): { relay: VoiceRelay; ear: FakeEar; listener: FakeListener } => {
  const ear = new FakeEar();
  const listener = new FakeListener();
  return { relay: new VoiceRelay(listener, ear.dial), ear, listener };
};

describe("VoiceRelay", () => {
  it("holds audio until Deepgram answers, then forwards it", () => {
    const { relay, ear, listener } = started();
    relay.audio(frame());
    relay.audio(frame());
    expect(ear.audioFrames).toBe(0);

    ear.handlers.opened();
    expect(listener.told).toEqual([{ type: "listening" }]);
    expect(ear.audioFrames).toBe(2);

    relay.audio(frame());
    expect(ear.audioFrames).toBe(3);
  });

  it("shows the words as they come and settles on the whole utterance", () => {
    const { relay, ear, listener } = started();
    ear.handlers.opened();
    ear.handlers.message(results("what is", false));
    ear.handlers.message(results("what is that", false));
    ear.handlers.message(results("What is that?", true));
    ear.handlers.message(results("Supposed to be?", true));
    expect(listener.told.filter((message) => message.type === "hearing").at(-1)).toEqual({
      type: "hearing",
      text: "What is that? Supposed to be?",
    });

    relay.done();
    expect(ear.sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
    ear.handlers.closed();
    expect(listener.last).toEqual({ type: "heard", text: "What is that? Supposed to be?" });
    expect(listener.closed).toBe(true);
  });

  it("closes the stream as soon as Deepgram opens, when the button was already let go", () => {
    const { relay, ear } = started();
    relay.audio(frame());
    relay.done();
    expect(ear.sent).toHaveLength(0);

    ear.handlers.opened();
    expect(ear.audioFrames).toBe(1);
    expect(ear.sent.at(-1)).toBe(JSON.stringify({ type: "CloseStream" }));
  });

  it("says nothing was heard when nobody spoke", () => {
    const { relay, ear, listener } = started();
    ear.handlers.opened();
    relay.done();
    ear.handlers.closed();
    expect(listener.last).toEqual({ type: "heard", text: "" });
  });

  it("reports trouble once and hangs up when Deepgram fails", () => {
    const { ear, listener } = started();
    ear.handlers.failed();
    ear.handlers.closed();
    expect(listener.told).toEqual([{ type: "trouble" }]);
    expect(listener.closed).toBe(true);
  });

  it("lets go of Deepgram when the browser disappears", () => {
    const { relay, ear, listener } = started();
    ear.handlers.opened();
    relay.abandon();
    ear.handlers.closed();
    expect(ear.closed).toBe(true);
    expect(listener.told).toEqual([{ type: "listening" }]);
  });
});
