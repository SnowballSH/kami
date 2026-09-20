// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiAccess } from "../http/access";
import { type AccessConfig, DEMO_ACCESS } from "../http/accessConfig";
import { SESSION_SECONDS } from "../http/sessions";
import { type VoiceSocketData, voiceSockets } from "./socket";

const ORIGIN = "https://kami.test";
const TOKEN = "a".repeat(64);
const SHARED = {
  ...DEMO_ACCESS,
  mode: "shared",
  origins: [ORIGIN],
  credentials: [
    { id: "player", token: TOKEN, boards: [], controllers: [], models: true },
    { id: "reader", token: "b".repeat(64), boards: [], controllers: [], models: false },
  ],
  modelConcurrency: 1,
} satisfies AccessConfig;
const CONFIG = { apiKey: "test-only-key", listenModel: "nova-3", speakModel: "aura-2-draco-en" };
const listen = (headers: HeadersInit = {}): Request =>
  new Request(`${ORIGIN}/api/voice/listen?rate=24000&wake=1`, { headers });
const respond = async (): Promise<Response> => Response.json({ ok: true });
const speak = (): Request =>
  new Request(`${ORIGIN}/api/voice/speak`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
const login = async (access: ApiAccess): Promise<string> => {
  const response = await access.handle(
    new Request(`${ORIGIN}/api/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
    }),
    respond,
  );
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
};
const listener = () => {
  let data: VoiceSocketData | undefined;
  return {
    upgrade: vi.fn((_request: Request, options?: { data?: VoiceSocketData }) => {
      data = options?.data;
      return true;
    }),
    socket: () => {
      if (data === undefined) throw new Error("No upgraded socket");
      return { data, send: vi.fn(() => 0), close: vi.fn() };
    },
  };
};

const peers: MockEar[] = [];
class MockEar extends EventTarget {
  static readonly OPEN = 1;
  readonly readyState = 1;
  binaryType = "arraybuffer";
  readonly send = vi.fn();
  readonly close = vi.fn();

  constructor() {
    super();
    peers.push(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  peers.length = 0;
  vi.stubGlobal("WebSocket", MockEar);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("voice upgrade access", () => {
  it.each([
    [{ origin: ORIGIN }, 401],
    [{ origin: ORIGIN, authorization: "Bearer wrong" }, 401],
    [{ origin: ORIGIN, authorization: `Bearer ${"b".repeat(64)}` }, 403],
    [{ origin: "https://evil.test", authorization: `Bearer ${TOKEN}` }, 403],
    [{ origin: "null", authorization: `Bearer ${TOKEN}` }, 403],
    [{ "sec-fetch-site": "cross-site", authorization: `Bearer ${TOKEN}` }, 403],
  ])("rejects invalid origin or credential before upgrading: %j", (headers, status) => {
    const voice = voiceSockets(CONFIG, new ApiAccess(SHARED));
    const server = listener();
    expect(voice.upgrade(listen(headers), server)?.status).toBe(status);
    expect(server.upgrade).not.toHaveBeenCalled();
    expect(peers).toHaveLength(0);
  });

  it("allows native WebSocket cookies and bearer clients, retaining microphone options", async () => {
    const access = new ApiAccess(SHARED);
    const cookie = await login(access);
    const voice = voiceSockets(CONFIG, access);
    for (const headers of [{ origin: ORIGIN, cookie }, { authorization: `Bearer ${TOKEN}` }]) {
      const server = listener();
      expect(voice.upgrade(listen(headers), server)).toBeUndefined();
      const socket = server.socket();
      expect(socket.data).toMatchObject({ continuous: true, format: { sampleRate: 24000 } });
      voice.websocket.open(socket);
      voice.websocket.close(socket);
    }
    expect(peers).toHaveLength(2);
    expect(peers.every((peer) => peer.close.mock.calls.length === 1)).toBe(true);
    expect((await access.handle(speak(), respond)).status).toBe(200);
  });

  it("keeps trusted demo WebSockets working and denies foreign origins", () => {
    const voice = voiceSockets(CONFIG);
    const server = listener();
    expect(voice.upgrade(listen({ origin: "https://evil.test" }), server)?.status).toBe(403);
    expect(voice.upgrade(listen({ origin: ORIGIN }), server)).toBeUndefined();
    const socket = server.socket();
    voice.websocket.open(socket);
    expect(peers).toHaveLength(1);
    voice.websocket.close(socket);
  });

  it("shares the model concurrency slot until the socket closes", async () => {
    const access = new ApiAccess(SHARED);
    const voice = voiceSockets(CONFIG, access);
    const server = listener();
    const request = listen({ authorization: `Bearer ${TOKEN}` });
    expect(voice.upgrade(request, server)).toBeUndefined();
    expect((await access.handle(speak(), respond)).status).toBe(429);
    expect(voice.upgrade(request, listener())?.status).toBe(429);
    voice.websocket.close(server.socket());
    expect((await access.handle(speak(), respond)).status).toBe(200);
  });

  it("charges successful upgrades against the aggregate request rate", async () => {
    const access = new ApiAccess({ ...SHARED, modelRequestsPerMinute: 1 });
    const voice = voiceSockets(CONFIG, access);
    const server = listener();
    expect(voice.upgrade(listen({ authorization: `Bearer ${TOKEN}` }), server)).toBeUndefined();
    voice.websocket.close(server.socket());
    expect((await access.handle(speak(), respond)).status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect((await access.handle(speak(), respond)).status).toBe(200);
  });

  it("releases the slot if voice is disabled, upgrade fails, or upstream cannot connect", async () => {
    const access = new ApiAccess(SHARED);
    const request = listen({ authorization: `Bearer ${TOKEN}` });
    expect(voiceSockets(null, access).upgrade(request, listener())?.status).toBe(501);
    const voice = voiceSockets(CONFIG, access);
    const refused = { upgrade: vi.fn(() => false) };
    expect(voice.upgrade(request, refused)?.status).toBe(400);
    const broken = {
      upgrade: () => {
        throw new Error("upgrade failed");
      },
    };
    expect(() => voice.upgrade(request, broken)).toThrow("upgrade failed");
    const server = listener();
    expect(voice.upgrade(request, server)).toBeUndefined();
    const socket = server.socket();
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor() {
          throw new Error("connection failed");
        }
      },
    );
    voice.websocket.open(socket);
    expect(socket.close).toHaveBeenCalledWith(1011, "voice connection failed");
    expect((await access.handle(speak(), respond)).status).toBe(200);
  });

  it.each(["logout", "expiry"])(
    "revokes idle sockets after %s without forwarding audio",
    async (how) => {
      const access = new ApiAccess(SHARED);
      const cookie = await login(access);
      const voice = voiceSockets(CONFIG, access);
      const server = listener();
      expect(voice.upgrade(listen({ cookie, origin: ORIGIN }), server)).toBeUndefined();
      const socket = server.socket();
      voice.websocket.open(socket);
      const peer = peers[0];
      if (peer === undefined) throw new Error("No upstream connection");
      peer.dispatchEvent(new Event("open"));
      if (how === "logout") {
        await access.handle(
          new Request(`${ORIGIN}/api/session`, { method: "DELETE", headers: { cookie } }),
          respond,
        );
        vi.advanceTimersByTime(15_000);
      } else {
        vi.advanceTimersByTime(SESSION_SECONDS * 1000);
      }
      voice.websocket.message(socket, Buffer.from([1, 2]));
      expect(socket.close).toHaveBeenCalledWith(1008, "access expired");
      expect(peer.close).toHaveBeenCalledOnce();
      expect(peer.send).not.toHaveBeenCalled();
      expect((await access.handle(speak(), respond)).status).toBe(200);
    },
  );

  it("rechecks a session before opening the upstream after an accepted handshake", async () => {
    const access = new ApiAccess(SHARED);
    const cookie = await login(access);
    const voice = voiceSockets(CONFIG, access);
    const server = listener();
    voice.upgrade(listen({ cookie, origin: ORIGIN }), server);
    vi.advanceTimersByTime(SESSION_SECONDS * 1000);
    const socket = server.socket();
    voice.websocket.open(socket);
    expect(socket.close).toHaveBeenCalledWith(1008, "access expired");
    expect(peers).toHaveLength(0);
    expect((await access.handle(speak(), respond)).status).toBe(200);
  });
});
