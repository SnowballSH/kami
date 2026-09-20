import { describe, expect, it } from "vitest";
import { listenSocketUrl } from "./api";
import { Ears } from "./ears";
import { toPcm16 } from "./pcm";
import type {
  Deafness,
  DialVoice,
  EarsHandlers,
  Microphone,
  MicrophoneDeafness,
  MicrophoneSession,
  SocketHandlers,
  VoiceSocket,
} from "./types";

class FakeMicrophone implements Microphone {
  onAudio: ((frame: Uint8Array<ArrayBuffer>) => void) | null = null;
  closed = false;
  #opening: ((session: MicrophoneSession | MicrophoneDeafness) => void) | null = null;
  readonly refuse: MicrophoneDeafness | null;

  constructor(refuse: MicrophoneDeafness | null = null) {
    this.refuse = refuse;
  }

  open(
    onAudio: (frame: Uint8Array<ArrayBuffer>) => void,
  ): Promise<MicrophoneSession | MicrophoneDeafness> {
    this.onAudio = onAudio;
    return new Promise((resolve) => {
      this.#opening = resolve;
    });
  }

  answer(): void {
    this.#opening?.(
      this.refuse ?? {
        sampleRate: 48_000,
        close: async () => {
          this.closed = true;
        },
      },
    );
    this.#opening = null;
  }

  speak(): void {
    this.onAudio?.(toPcm16(new Float32Array([0.5, -0.5])));
  }
}

class FakeSocket implements VoiceSocket {
  readonly sent: (string | Uint8Array)[] = [];
  closed = false;
  handlers!: SocketHandlers;
  sampleRate = 0;

  dials = 0;
  wake = false;

  readonly dial: DialVoice = (sampleRate, handlers, options) => {
    this.sampleRate = sampleRate;
    this.handlers = handlers;
    this.wake = options.wake;
    this.dials += 1;
    this.closed = false;
    this.sent.length = 0;
    return this;
  };

  send(data: Uint8Array<ArrayBuffer> | string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  tell(message: unknown): void {
    this.handlers.message(JSON.stringify(message));
  }

  get frames(): number {
    return this.sent.filter((data) => typeof data !== "string").length;
  }
}

const heard: string[] = [];

const listen = () => {
  const microphone = new FakeMicrophone();
  const socket = new FakeSocket();
  const said: string[] = [];
  const spoken: string[] = [];
  const listening: boolean[] = [];
  const waking: boolean[] = [];
  const deaf: Deafness[] = [];
  const later: (() => void)[] = [];
  const handlers: EarsHandlers = {
    onHearing: (text) => said.push(text),
    onHeard: (text) => spoken.push(text),
    onListeningChanged: (on) => listening.push(on),
    onWakingChanged: (on) => waking.push(on),
    onDeaf: (reason) => deaf.push(reason),
  };
  return {
    ears: new Ears(microphone, socket.dial, handlers, (todo) => later.push(todo)),
    microphone,
    socket,
    said,
    spoken,
    listening,
    waking,
    deaf,
    later,
  };
};

/** The microphone and the socket both come up, for whichever listening was just asked for. */
const settle = async (microphone: FakeMicrophone, socket: FakeSocket): Promise<void> => {
  microphone.answer();
  await Promise.resolve();
  socket.handlers.opened();
};

describe("Ears", () => {
  it("opens the microphone on hold and streams once the socket is up", async () => {
    const { ears, microphone, socket, listening } = listen();
    ears.hold();
    expect(listening).toEqual([true]);
    microphone.answer();
    await Promise.resolve();

    expect(socket.sampleRate).toBe(48_000);
    microphone.speak();
    expect(socket.frames).toBe(0);

    socket.handlers.opened();
    expect(socket.frames).toBe(1);
    microphone.speak();
    expect(socket.frames).toBe(2);
  });

  it("shows the words as they arrive and interprets the utterance", async () => {
    const { ears, microphone, socket, said, spoken, listening } = listen();
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    socket.handlers.opened();
    socket.tell({ type: "listening" });
    socket.tell({ type: "hearing", text: "make alice" });
    socket.tell({ type: "hearing", text: "make alice fly" });

    ears.release();
    expect(microphone.closed).toBe(true);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "done" }));

    socket.tell({ type: "heard", text: "make alice fly" });
    expect(said).toEqual(["make alice", "make alice fly"]);
    expect(spoken).toEqual(["make alice fly"]);
    expect(listening).toEqual([true, false]);
    expect(socket.closed).toBe(true);
  });

  it("says nothing when nothing was made out", async () => {
    const { ears, microphone, socket, spoken } = listen();
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    socket.handlers.opened();
    ears.release();
    socket.tell({ type: "heard", text: "" });
    expect(spoken).toEqual([]);
  });

  it("sends everything it caught when the press ends before the socket opens", async () => {
    const { ears, microphone, socket } = listen();
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    microphone.speak();
    ears.release();
    expect(socket.sent).toHaveLength(0);

    socket.handlers.opened();
    expect(socket.frames).toBe(1);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "done" }));
  });

  it("stops listening when the press ends before the microphone opens", async () => {
    const { ears, microphone, socket, listening } = listen();
    ears.hold();
    ears.release();
    microphone.answer();
    await Promise.resolve();
    expect(microphone.closed).toBe(true);
    expect(socket.sampleRate).toBe(0);
    expect(listening).toEqual([true, false]);
  });

  it("gives up and says why when the microphone is refused", async () => {
    const microphone = new FakeMicrophone("refused");
    const socket = new FakeSocket();
    const listening: boolean[] = [];
    const deaf: Deafness[] = [];
    const ears = new Ears(microphone, socket.dial, {
      onHearing: () => heard.push("no"),
      onHeard: () => heard.push("no"),
      onListeningChanged: (on) => listening.push(on),
      onWakingChanged: () => heard.push("no"),
      onDeaf: (reason) => deaf.push(reason),
    });
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    expect(listening).toEqual([true, false]);
    expect(deaf).toEqual(["refused"]);
    expect(ears.listening).toBe(false);
  });

  it("says the page is insecure when a plain http page has no microphone at all", async () => {
    const microphone = new FakeMicrophone("insecure");
    const socket = new FakeSocket();
    const deaf: Deafness[] = [];
    const ears = new Ears(microphone, socket.dial, {
      onHearing: () => heard.push("no"),
      onHeard: () => heard.push("no"),
      onListeningChanged: () => {},
      onWakingChanged: () => heard.push("no"),
      onDeaf: (reason) => deaf.push(reason),
    });
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    expect(deaf).toEqual(["insecure"]);
    expect(socket.sampleRate).toBe(0);
  });

  it("blames the server when the socket is refused before it opens", async () => {
    const { ears, microphone, socket, listening, deaf } = listen();
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    socket.handlers.closed();
    expect(deaf).toEqual(["server"]);
    expect(listening).toEqual([true, false]);
    expect(microphone.closed).toBe(true);
  });

  it("blames the server on trouble, and stops waking rather than retrying forever", async () => {
    const { ears, microphone, socket, waking, deaf, later } = listen();
    ears.wake(true);
    await settle(microphone, socket);
    socket.tell({ type: "trouble" });
    expect(deaf).toEqual(["server"]);
    expect(waking).toEqual([true, false]);
    expect(ears.waking).toBe(false);
    expect(later).toHaveLength(0);
  });

  it("waits for his name, then takes the rest of the breath as the utterance", async () => {
    const { ears, microphone, socket, spoken, said } = listen();
    ears.wake(true);
    await settle(microphone, socket);
    expect(socket.wake).toBe(true);

    socket.tell({ type: "hearing", text: "just talking" });
    socket.tell({ type: "heard", text: "so anyway I told her that." });
    expect(said).toEqual([]);
    expect(spoken).toEqual([]);

    socket.tell({ type: "heard", text: "Kami, make gravity the moon's." });
    expect(spoken).toEqual(["make gravity the moon's"]);
    expect(socket.closed).toBe(false);
  });

  it("takes the next breath when his name is said on its own", async () => {
    const { ears, microphone, socket, spoken, listening } = listen();
    ears.wake(true);
    await settle(microphone, socket);

    socket.tell({ type: "heard", text: "Kami?" });
    expect(spoken).toEqual([]);
    expect(listening).toEqual([true]);

    socket.tell({ type: "heard", text: "make her fly." });
    expect(spoken).toEqual(["make her fly"]);
    expect(listening).toEqual([true, false]);
  });

  it("gives the microphone to a press, and goes back to waiting after it", async () => {
    const { ears, microphone, socket, spoken } = listen();
    ears.wake(true);
    await settle(microphone, socket);

    ears.hold();
    expect(socket.closed).toBe(true);
    await settle(microphone, socket);
    expect(socket.wake).toBe(false);
    ears.release();
    socket.tell({ type: "heard", text: "draw a ladder" });

    expect(spoken).toEqual(["draw a ladder"]);
    await settle(microphone, socket);
    expect(socket.wake).toBe(true);
    expect(ears.waking).toBe(true);
  });

  it("does not let the hung-up wake stream take the microphone back off the press", async () => {
    const { ears, microphone, socket, later } = listen();
    ears.wake(true);
    await settle(microphone, socket);
    const hungUp = socket.handlers;

    ears.hold();
    hungUp.closed();
    await settle(microphone, socket);

    expect(socket.wake).toBe(false);
    expect(later).toHaveLength(0);
    microphone.speak();
    expect(socket.frames).toBe(1);
  });

  it("listens again after Deepgram hangs up on a standing stream", async () => {
    const { ears, microphone, socket, later } = listen();
    ears.wake(true);
    await settle(microphone, socket);
    const dials = socket.dials;

    socket.handlers.closed();
    expect(later).toHaveLength(1);
    later[0]?.();
    await settle(microphone, socket);
    expect(socket.dials).toBe(dials + 1);

    ears.wake(false);
    expect(socket.closed).toBe(true);
    expect(ears.waking).toBe(false);
  });

  it("turns waiting back off when the microphone is refused", async () => {
    const microphone = new FakeMicrophone("refused");
    const socket = new FakeSocket();
    const waking: boolean[] = [];
    const ears = new Ears(microphone, socket.dial, {
      onHearing: () => heard.push("no"),
      onHeard: () => heard.push("no"),
      onListeningChanged: () => heard.push("no"),
      onWakingChanged: (on) => waking.push(on),
      onDeaf: () => {},
    });
    ears.wake(true);
    microphone.answer();
    await Promise.resolve();

    expect(waking).toEqual([true, false]);
    expect(ears.waking).toBe(false);
  });

  it("ignores a second hold while one press is already live", async () => {
    const { ears, microphone, socket } = listen();
    ears.hold();
    ears.hold();
    microphone.answer();
    await Promise.resolve();
    ears.hold();
    expect(socket.sampleRate).toBe(48_000);
  });

  it("cancels a pending transcript and wake reconnect on board navigation", async () => {
    const { ears, microphone, socket, spoken, later } = listen();
    ears.wake(true);
    await settle(microphone, socket);
    ears.hold();
    await settle(microphone, socket);
    ears.release();
    const previous = socket.handlers;
    ears.cancel();
    previous.message(JSON.stringify({ type: "heard", text: "gravity off" }));
    previous.closed();
    expect(spoken).toEqual([]);
    expect(later).toEqual([]);
    expect(socket.closed).toBe(true);
    expect(microphone.closed).toBe(true);
    expect(ears.waking).toBe(false);
  });

  it("clears the listening indicator when an armed wake stream is switched off", async () => {
    const { ears, microphone, socket, listening } = listen();
    ears.wake(true);
    await settle(microphone, socket);
    socket.tell({ type: "heard", text: "Kami" });
    ears.wake(false);
    expect(listening).toEqual([true, false]);
    expect(ears.listening).toBe(false);
  });
});

describe("listenSocketUrl", () => {
  it("speaks to the same origin, over ws or wss", () => {
    expect(listenSocketUrl(48_000, { href: "http://kami.local:5173/" } as Location)).toBe(
      "ws://kami.local:5173/api/voice/listen?rate=48000",
    );
    expect(listenSocketUrl(24_000, { href: "https://kami.test/play" } as Location)).toBe(
      "wss://kami.test/api/voice/listen?rate=24000",
    );
    expect(
      listenSocketUrl(16_000, { href: "http://kami.local/" } as Location, { wake: true }),
    ).toBe("ws://kami.local/api/voice/listen?rate=16000&wake=1");
  });
});
