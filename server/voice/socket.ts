import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import { ApiAccess, type ModelStream } from "../http/access";
import { badRequest, notImplemented } from "../http/responses";
import { listenUrl, MAX_SAMPLE_RATE, MIN_SAMPLE_RATE, tokenProtocol } from "./deepgram";
import { type DialEar, type Ear, type EarHandlers, VoiceRelay } from "./relay";
import type { AudioFormat, VoiceConfig, VoiceMessage } from "./types";

export const VOICE_SOCKET_PATH = "/api/voice/listen";

const DEFAULT_SAMPLE_RATE = 16_000;
const DONE = "done";
const AUTHORIZATION_INTERVAL_MS = 15_000;

export interface VoiceSocketData {
  readonly kind: "voice";
  readonly format: AudioFormat;
  /** Listening for the wake word: one long stream of utterances, not one press. */
  readonly continuous: boolean;
  readonly access: ModelStream;
  authorizationTimer: ReturnType<typeof setInterval> | null;
  relay: VoiceRelay | null;
}

type VoiceClient = Pick<ServerWebSocket<VoiceSocketData>, "data" | "send" | "close">;

const release = (socket: VoiceClient): void => {
  if (socket.data.authorizationTimer !== null) clearInterval(socket.data.authorizationTimer);
  socket.data.authorizationTimer = null;
  socket.data.relay?.abandon();
  socket.data.relay = null;
  socket.data.access.release();
};

const authorized = (socket: VoiceClient): boolean => {
  if (socket.data.access.authorized()) return true;
  release(socket);
  socket.close(1008, "access expired");
  return false;
};

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
export const voiceSockets = (config: VoiceConfig | null, access: ApiAccess = new ApiAccess()) => ({
  upgrade: (
    request: Request,
    server: Pick<Server<VoiceSocketData>, "upgrade">,
  ): Response | undefined => {
    const grant = access.openModelStream(request);
    if (grant instanceof Response) return grant;
    if (config === null) {
      grant.release();
      return notImplemented("no voice is attached");
    }
    const data: VoiceSocketData = {
      kind: "voice",
      format: { sampleRate: sampleRateOf(request.url) },
      continuous: isWaking(request.url),
      access: grant,
      authorizationTimer: null,
      relay: null,
    };
    try {
      if (server.upgrade(request, { data })) return undefined;
      grant.release();
      return badRequest("WebSocket upgrade required");
    } catch (error) {
      grant.release();
      throw error;
    }
  },
  websocket: {
    open: (socket: VoiceClient) => {
      if (!authorized(socket)) return;
      if (config === null) {
        release(socket);
        socket.close();
        return;
      }
      socket.data.authorizationTimer = setInterval(
        () => authorized(socket),
        AUTHORIZATION_INTERVAL_MS,
      );
      try {
        socket.data.relay = new VoiceRelay(
          {
            tell: (message: VoiceMessage) => {
              if (authorized(socket)) socket.send(JSON.stringify(message));
            },
            close: () => socket.close(),
          },
          dialDeepgram(config, socket.data.format),
          { continuous: socket.data.continuous },
        );
      } catch {
        release(socket);
        socket.close(1011, "voice connection failed");
      }
    },
    message: (socket: VoiceClient, message: string | Buffer) => {
      if (!authorized(socket)) return;
      const relay = socket.data.relay;
      if (relay === null) return;
      if (typeof message === "string") {
        if (isDone(message)) relay.done();
      } else {
        relay.audio(message);
      }
    },
    close: (socket: VoiceClient) => release(socket),
  } satisfies WebSocketHandler<VoiceSocketData>,
});
