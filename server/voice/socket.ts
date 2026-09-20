import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { listenUrl, MAX_SAMPLE_RATE, MIN_SAMPLE_RATE, tokenProtocol } from "./deepgram";
import { type DialEar, type Ear, type EarHandlers, VoiceRelay } from "./relay";
import type { AudioFormat, VoiceConfig, VoiceMessage } from "./types";

export const VOICE_SOCKET_PATH = "/api/voice/listen";

const DEFAULT_SAMPLE_RATE = 16_000;
const DONE = "done";

export interface VoiceSocketData {
  readonly format: AudioFormat;
  /** Listening for the wake word: one long stream of utterances, not one press. */
  readonly continuous: boolean;
  relay: VoiceRelay | null;
}

/** `?wake=1`: the browser is listening for "kami" rather than holding a button. */
export const isWaking = (url: string): boolean => new URL(url).searchParams.get("wake") === "1";

export const sampleRateOf = (url: string): number => {
  const asked = Number(new URL(url).searchParams.get("rate"));
  const rate = Math.round(asked);
  return Number.isFinite(rate) && rate >= MIN_SAMPLE_RATE && rate <= MAX_SAMPLE_RATE
    ? rate
    : DEFAULT_SAMPLE_RATE;
};

const dialDeepgram =
  (config: VoiceConfig, format: AudioFormat): DialEar =>
  (handlers: EarHandlers): Ear => {
    const socket = new WebSocket(listenUrl(config, format), tokenProtocol(config));
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => handlers.opened());
    socket.addEventListener("message", (event) => handlers.message(String(event.data)));
    socket.addEventListener("error", () => handlers.failed());
    socket.addEventListener("close", () => handlers.closed());
    return {
      send: (audio) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(audio);
      },
      close: () => socket.close(),
    };
  };

const isDone = (message: string): boolean => {
  try {
    return (JSON.parse(message) as { type?: unknown }).type === DONE;
  } catch {
    return false;
  }
};

/**
 * The browser never holds the Deepgram key: it sends microphone audio here and this relays it,
 * press by press (`docs/voice.md`).
 */
export const voiceSockets = (
  config: VoiceConfig | null,
): {
  readonly upgrade: (request: Request, server: Server<VoiceSocketData>) => boolean;
  readonly websocket: WebSocketHandler<VoiceSocketData>;
} => ({
  upgrade: (request, server) => {
    if (config === null) return false;
    const data: VoiceSocketData = {
      format: { sampleRate: sampleRateOf(request.url) },
      continuous: isWaking(request.url),
      relay: null,
    };
    return server.upgrade(request, { data });
  },
  websocket: {
    open: (socket: ServerWebSocket<VoiceSocketData>) => {
      if (config === null) {
        socket.close();
        return;
      }
      socket.data.relay = new VoiceRelay(
        {
          tell: (message: VoiceMessage) => socket.send(JSON.stringify(message)),
          close: () => socket.close(),
        },
        dialDeepgram(config, socket.data.format),
        { continuous: socket.data.continuous },
      );
    },
    message: (socket: ServerWebSocket<VoiceSocketData>, message) => {
      const relay = socket.data.relay;
      if (relay === null) return;
      if (typeof message === "string") {
        if (isDone(message)) relay.done();
      } else {
        relay.audio(message);
      }
    },
    close: (socket: ServerWebSocket<VoiceSocketData>) => socket.data.relay?.abandon(),
  },
});
