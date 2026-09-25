// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../config";
import { InMemoryControllerHub } from "../controllers/hub";
import { readEvents } from "../controllers/testing/eventReader";
import { BoardRepository } from "../db/boardRepository";
import type { DatabaseConnection } from "../db/connect";
import { startMemoryDatabase } from "../testing/memoryDatabase";
import { ApiAccess } from "./access";
import { type AccessConfig, type Credential, DEMO_ACCESS, readAccessConfig } from "./accessConfig";
import { createApi } from "./api";
import { SESSION_SECONDS } from "./sessions";

const ORIGIN = "https://kami.test";
const ALICE: Credential = {
  id: "alice",
  token: "a".repeat(64),
  boards: ["my game"],
  controllers: ["arcade"],
  models: true,
};
const BOB: Credential = {
  id: "bob",
  token: "b".repeat(64),
  boards: ["private"],
  controllers: ["other"],
  models: false,
};
const SHARED: AccessConfig = {
  ...DEMO_ACCESS,
  mode: "shared",
  origins: [ORIGIN],
  credentials: [ALICE, BOB],
};
const ENV = {
  KAMI_ACCESS_MODE: "shared",
  KAMI_ALLOWED_ORIGINS: ORIGIN,
  KAMI_CREDENTIALS: JSON.stringify(SHARED.credentials),
};
const STROKES = [[{ x: 1, y: 2 }]];
const RABBIT = {
  word: "rabbit",
  strokes: [
    [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ],
  ],
};
const NOTE = {
  id: "note",
  text: "hello",
  author: "player",
  position: { x: 1, y: 2 },
  tone: "plain",
  createdAt: 0,
  fleeting: false,
};
const bearer = (credential = ALICE): HeadersInit => ({
  authorization: `Bearer ${credential.token}`,
  origin: ORIGIN,
});
const request = (path: string, init?: RequestInit): Request =>
  new Request(`${ORIGIN}/api/${path}`, init);

describe("deployment configuration", () => {
  it("keeps the iPad LAN demo and makes shared binds loopback by default", () => {
    expect(readConfig({})).toMatchObject({
      hostname: "0.0.0.0",
      access: { mode: "demo", origins: [] },
      controllers: { udpPort: 8788 },
    });
    expect(readConfig(ENV)).toMatchObject({
      hostname: "127.0.0.1",
      access: SHARED,
      controllers: { udpPort: null },
    });
    expect(readConfig({ ...ENV, KAMI_BIND_HOST: "10.0.0.2" }).hostname).toBe("10.0.0.2");
  });

  it.each([
    { KAMI_ACCESS_MODE: "shraed" },
    { KAMI_CREDENTIALS: undefined },
    { KAMI_CREDENTIALS: "[]" },
    { KAMI_CREDENTIALS: JSON.stringify([{ ...ALICE, token: "weak" }]) },
    { KAMI_CREDENTIALS: JSON.stringify([ALICE, ALICE]) },
    { KAMI_ALLOWED_ORIGINS: "" },
    { KAMI_ALLOWED_ORIGINS: "*" },
    { KAMI_ALLOWED_ORIGINS: "null" },
    { KAMI_ALLOWED_ORIGINS: "http://kami.test" },
    { KAMI_ALLOWED_ORIGINS: `${ORIGIN}/path` },
    { KAMI_CONTROLLER_UDP_PORT: "8788" },
    { KAMI_MODEL_REQUESTS_PER_MINUTE: "unlimited" },
    { KAMI_MODEL_CONCURRENCY: "0" },
  ])("fails closed for invalid shared settings: %j", (override) => {
    expect(() => readConfig({ ...ENV, ...override })).toThrow();
  });

  it("allows explicit demo origins and finite work limits", () => {
    expect(
      readAccessConfig({
        KAMI_ALLOWED_ORIGINS: "http://ipad.test:5173",
        KAMI_MODEL_REQUESTS_PER_MINUTE: "60",
        KAMI_MODEL_CONCURRENCY: "2",
      }),
    ).toMatchObject({
      origins: ["http://ipad.test:5173"],
      modelRequestsPerMinute: 60,
      modelConcurrency: 2,
    });
  });

  it("turns KAMI_PASSWORD into a shared server with one grant for everything", () => {
    const password = readAccessConfig({
      KAMI_PASSWORD: "  correct horse  ",
      KAMI_ALLOWED_ORIGINS: ORIGIN,
    });
    expect(password).toMatchObject({
      mode: "shared",
      password: "correct horse",
      credentials: [],
      origins: [ORIGIN],
    });
    expect(readConfig({ KAMI_PASSWORD: "pw", KAMI_ALLOWED_ORIGINS: ORIGIN })).toMatchObject({
      hostname: "127.0.0.1",
      controllers: { udpPort: null },
    });
    expect(readAccessConfig({ ...ENV, KAMI_PASSWORD: "pw" })).toMatchObject({
      password: "pw",
      credentials: [ALICE, BOB],
    });
    expect(
      readConfig(
        { KAMI_PASSWORD_FILE: "/run/secrets/kami", KAMI_ALLOWED_ORIGINS: ORIGIN },
        () => "from a file\n",
      ).access.password,
    ).toBe("from a file");
    expect(
      readAccessConfig({ KAMI_PASSWORD: "pw", KAMI_ALLOWED_ORIGINS: "http://localhost:5173" })
        .origins,
    ).toEqual(["http://localhost:5173"]);
    expect(readAccessConfig({ KAMI_PASSWORD: "", KAMI_ALLOWED_ORIGINS: ORIGIN }).mode).toBe("demo");
  });

  it.each([
    [{ KAMI_ACCESS_MODE: "demo" }, /remove KAMI_ACCESS_MODE=demo/],
    [{ KAMI_ALLOWED_ORIGINS: undefined }, /KAMI_ALLOWED_ORIGINS/],
    [{ KAMI_ALLOWED_ORIGINS: "http://kami.test" }, /HTTPS/],
    [{ KAMI_PASSWORD: "x".repeat(1025) }, /at most 1024/],
    [{ KAMI_CREDENTIALS: "not json" }, /valid KAMI_CREDENTIALS/],
    [{ KAMI_CREDENTIALS: JSON.stringify([{ ...ALICE, id: "password" }]) }, /distinct ids/],
    [{ KAMI_CREDENTIALS: JSON.stringify([ALICE]), KAMI_PASSWORD: ALICE.token }, /distinct/],
    [{ KAMI_TRUSTED_PROXIES: "proxy.local" }, /IP addresses/],
    [{ KAMI_CONTROLLER_UDP_PORT: "8788" }, /UDP/],
  ])("refuses to start a password gate with %j", (override, reason) => {
    expect(() =>
      readConfig({ KAMI_PASSWORD: "pw", KAMI_ALLOWED_ORIGINS: ORIGIN, ...override }),
    ).toThrow(reason);
  });

  it("retains independent transcription settings in shared mode", () => {
    expect(
      readConfig({
        ...ENV,
        KAMI_LLM_URL: "http://llm.example:8000",
        KAMI_LLM_MODEL: "compiler",
        KAMI_TRANSCRIBE_MODEL: "handwriting",
      }),
    ).toMatchObject({
      access: SHARED,
      hostname: "127.0.0.1",
      transcribe: { model: "handwriting" },
      llm: { model: "compiler" },
    });
  });
});

describe("shared API access", () => {
  let connection: DatabaseConnection;
  let boards: BoardRepository;
  let controllers: InMemoryControllerHub;
  let api: ReturnType<typeof createApi>;
  let access: ApiAccess;
  let now = 1_000_000;
  const compile = vi.fn(async () => null);
  const recognize = vi.fn(async () => ({ ranking: [], certainAbove: null }));
  const beautify = vi.fn(async () => Response.json({ tidied: STROKES, added: [] }));
  const transcribe = vi.fn(async () => "hello");
  const exemplar = vi.fn(async (word: string) => (word === "rabbit" ? RABBIT : null));

  beforeAll(async () => {
    connection = await startMemoryDatabase();
    boards = new BoardRepository(connection.db);
  }, 120_000);
  beforeEach(async () => {
    await connection.db.dropDatabase();
    controllers?.close();
    controllers = new InMemoryControllerHub();
    now = 1_000_000;
    access = new ApiAccess(SHARED, () => now);
    api = createApi({
      boards,
      controllers,
      access,
      compiler: { compile },
      recognizer: { read: recognize },
      beautifier: { beautify },
      transcriber: { transcribe, ready: true, warmUp: async () => true },
      exemplars: { categories: ["rabbit"], exemplar },
    });
    vi.clearAllMocks();
    await boards.upsert("notes", "my game", NOTE.id, NOTE);
    await boards.upsert("notes", "private", NOTE.id, { ...NOTE, text: "private note" });
  });
  afterAll(async () => {
    controllers.close();
    await connection.close();
  });

  const login = async (): Promise<string> => {
    const response = await api.handle(request("session", { method: "POST", headers: bearer() }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(cookie).not.toContain(ALICE.token);
    return cookie.split(";")[0] ?? "";
  };

  it.each([
    ["GET", "boards"],
    ["GET", "boards/my%20game"],
    ["PUT", "boards/my%20game/notes/note"],
    ["DELETE", "boards/my%20game"],
    ["GET", "controllers"],
    ["POST", "controllers/arcade/state"],
    ["GET", "controllers/arcade/events"],
    ["POST", "compile"],
    ["POST", "recognize"],
    ["POST", "beautify"],
    ["POST", "transcribe"],
    ["GET", "exemplar?word=rabbit"],
    ["GET", "exemplars"],
  ])("denies unauthenticated %s %s before touching data or models", async (method, path) => {
    const response = await api.handle(request(path, { method }));
    expect(response.status).toBe(401);
    expect(compile).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(beautify).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(exemplar).not.toHaveBeenCalled();
    expect((await boards.snapshot("my game")).notes).toHaveLength(1);
    expect(controllers.list()).toEqual([]);
  });

  it("answers the health probe without a session, and nothing else about itself", async () => {
    const response = await api.handle(request("health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect((await api.handle(request("health", { method: "POST" }))).status).toBe(401);
    expect(
      (await api.handle(request("health", { headers: { origin: "https://evil.test" } }))).status,
    ).toBe(403);
  });

  it("filters board and controller listings and blocks reads and mutations outside a grant", async () => {
    controllers.report("arcade", { x: 0, y: 0, buttons: [] }, "http");
    controllers.report("other", { x: 1, y: 0, buttons: [] }, "http");
    expect(await (await api.handle(request("boards", { headers: bearer() }))).json()).toEqual({
      boards: [{ id: "my game", drawings: 0, rules: 0 }],
    });
    expect(await (await api.handle(request("controllers", { headers: bearer() }))).json()).toEqual([
      expect.objectContaining({ id: "arcade" }),
    ]);
    for (const method of ["GET", "PUT", "DELETE"]) {
      expect(
        (await api.handle(request("boards/private", { method, headers: bearer() }))).status,
      ).toBe(403);
    }
    expect(
      (
        await api.handle(
          request("boards/private/notes/note", { method: "DELETE", headers: bearer() }),
        )
      ).status,
    ).toBe(403);
    expect((await boards.snapshot("private")).notes).toHaveLength(1);
    expect(
      (await api.handle(request("controllers/other/events", { headers: bearer() }))).status,
    ).toBe(403);
    expect(
      (
        await api.handle(
          request("controllers/other/state", { method: "POST", headers: bearer(), body: "100 0" }),
        )
      ).status,
    ).toBe(403);
  });

  it("allows encoded board ids, upsert and delete with the same browser session cookie", async () => {
    const cookie = await login();
    const headers = { cookie, origin: ORIGIN, "content-type": "application/json" };
    expect((await api.handle(request("boards/my%20game", { headers }))).status).toBe(200);
    expect(
      (
        await api.handle(
          request("boards/my%20game/notes/note", {
            method: "PUT",
            headers,
            body: JSON.stringify(NOTE),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await api.handle(request("boards/my%20game", { method: "DELETE", headers }))).status,
    ).toBe(200);
    expect((await boards.snapshot("my game")).notes).toEqual([]);
  });

  it.each([
    ["recognize", { strokes: STROKES }],
    ["beautify", { strokes: STROKES }],
    ["compile", { text: "gravity like mars" }],
    ["transcribe", { strokes: STROKES }],
  ])("authenticates %s through both cookies and bearer credentials", async (path, body) => {
    const cookie = await login();
    for (const headers of [{ cookie, origin: ORIGIN }, bearer()]) {
      expect(
        (await api.handle(request(path, { method: "POST", headers, body: JSON.stringify(body) })))
          .status,
      ).toBe(200);
    }
    expect(
      (
        await api.handle(
          request(path, { method: "POST", headers: bearer(BOB), body: JSON.stringify(body) }),
        )
      ).status,
    ).toBe(403);
  });

  it("allows exemplar reads with a model grant through cookies and bearer credentials", async () => {
    const cookie = await login();
    for (const headers of [{ cookie, origin: ORIGIN }, bearer()]) {
      const response = await api.handle(request("exemplar?word=rabbit", { headers }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(RABBIT);
      expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    }
    expect(exemplar).toHaveBeenCalledTimes(2);
    expect(exemplar).toHaveBeenCalledWith("rabbit");
  });

  it("denies exemplar reads without a model grant or from a hostile origin before lookup", async () => {
    for (const headers of [bearer(BOB), { ...bearer(), origin: "https://evil.test" }]) {
      expect((await api.handle(request("exemplar?word=rabbit", { headers }))).status).toBe(403);
      expect((await api.handle(request("exemplars", { headers }))).status).toBe(403);
    }
    expect(exemplar).not.toHaveBeenCalled();
  });

  it("lists the catalogue with a model grant", async () => {
    const response = await api.handle(request("exemplars", { headers: bearer() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ categories: ["rabbit"] });
  });

  it("keeps exemplar validation, missing drawings and unsupported methods after authorization", async () => {
    expect((await api.handle(request("exemplar", { headers: bearer() }))).status).toBe(400);
    expect((await api.handle(request("exemplar?word=unknown", { headers: bearer() }))).status).toBe(
      404,
    );
    expect(
      (await api.handle(request("exemplar?word=rabbit", { method: "POST", headers: bearer() })))
        .status,
    ).toBe(404);
    expect(exemplar).toHaveBeenCalledOnce();
    expect(exemplar).toHaveBeenCalledWith("unknown");
  });

  it.each([DEMO_ACCESS, SHARED])(
    "shares exemplar rate and concurrency limits with model work in $mode mode",
    async (config) => {
      const limited = createApi({
        boards,
        controllers,
        access: new ApiAccess(
          { ...config, modelRequestsPerMinute: 2, modelConcurrency: 1 },
          () => now,
        ),
        compiler: { compile },
        recognizer: { read: recognize },
        beautifier: { beautify },
        exemplars: { categories: [], exemplar },
      });
      let finish: () => void = () => {};
      exemplar.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(RABBIT);
          }),
      );
      const first = limited.handle(request("exemplar?word=rabbit", { headers: bearer() }));
      const compileRequest = () =>
        request("compile", {
          method: "POST",
          headers: bearer(),
          body: JSON.stringify({ text: "gravity like mars" }),
        });
      try {
        expect((await limited.handle(compileRequest())).status).toBe(429);
        expect(compile).not.toHaveBeenCalled();
      } finally {
        finish();
      }
      expect(await (await first).json()).toEqual(RABBIT);
      expect((await limited.handle(compileRequest())).status).toBe(200);
      const rejected = await limited.handle(
        request("exemplar//?word=rabbit", { headers: bearer() }),
      );
      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("retry-after")).toBe("60");
      expect(exemplar).toHaveBeenCalledOnce();
      expect(
        (await limited.handle(request("boards/my%20game", { headers: bearer() }))).status,
      ).toBe(200);
      now += 60_000;
      expect(
        (await limited.handle(request("exemplar?word=rabbit", { headers: bearer() }))).status,
      ).toBe(200);
    },
  );

  it("authenticates native EventSource cookies and HTTP controller reports", async () => {
    const cookie = await login();
    const response = await api.handle(
      request("controllers/arcade/events", { headers: { cookie } }),
    );
    const events = readEvents(response);
    expect(await events.nextEvent()).toMatchObject({ x: 0, y: 0 });
    expect(
      (
        await api.handle(
          request("controllers/arcade/state", { method: "POST", headers: bearer(), body: "100 0" }),
        )
      ).status,
    ).toBe(204);
    expect(await events.nextEvent()).toMatchObject({ x: 1, held: ["right"] });
    await events.cancel();
  });

  it("expires and revokes cookies and never accepts URL credentials", async () => {
    const cookie = await login();
    now += SESSION_SECONDS * 1000;
    expect((await api.handle(request("boards", { headers: { cookie } }))).status).toBe(401);
    const second = await login();
    await api.handle(request("session", { method: "DELETE", headers: { cookie: second } }));
    expect((await api.handle(request("boards", { headers: { cookie: second } }))).status).toBe(401);
    expect((await api.handle(request(`boards?token=${ALICE.token}`))).status).toBe(401);
    expect(
      (
        await api.handle(
          request("boards", { headers: { cookie: second, authorization: "Bearer wrong" } }),
        )
      ).status,
    ).toBe(401);
  });

  it("closes existing controller streams after logout before delivering another state", async () => {
    const cookie = await login();
    const response = await api.handle(
      request("controllers/arcade/events", { headers: { cookie } }),
    );
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error("Missing controller stream");
    await reader.read();
    await reader.read();
    await api.handle(request("session", { method: "DELETE", headers: { cookie } }));
    controllers.report("arcade", { x: 1, y: 0, buttons: [] }, "http");
    expect((await reader.read()).done).toBe(true);
  });

  it("does not expose unscoped listings if a session expires while data is loading", async () => {
    const cookie = await login();
    const summaries = await boards.summaries();
    const list = vi.spyOn(boards, "summaries").mockImplementationOnce(async () => {
      now += SESSION_SECONDS * 1000;
      return summaries;
    });
    try {
      const response = await api.handle(request("boards", { headers: { cookie } }));
      expect(await response.json()).toEqual({ boards: [] });
    } finally {
      list.mockRestore();
    }
  });

  it("reveals no scopes to anonymous session checks and rate limits invalid logins", async () => {
    expect(await (await api.handle(request("session"))).json()).toEqual({
      mode: "shared",
      authenticated: false,
      boards: [],
      controllers: [],
      secret: "token",
      unrestricted: false,
    });
    for (let i = 0; i < 30; i++) {
      expect((await api.handle(request("session", { method: "POST" }), `10.0.0.${i}`)).status).toBe(
        401,
      );
    }
    expect(
      (await api.handle(request("session", { method: "POST", headers: bearer() }))).status,
    ).toBe(429);
    now += 60_000;
    await login();
  });

  it("rejects hostile, opaque and spoofed same-host origins even with valid credentials", async () => {
    for (const origin of ["https://evil.test", "null", "https://kami.test.evil.test"]) {
      const response = await api.handle(
        request("boards/my%20game", { method: "DELETE", headers: { ...bearer(), origin } }),
      );
      expect(response.status).toBe(403);
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
    }
    const spoofed = new Request("https://evil.test/api/boards", {
      headers: { ...bearer(), origin: "https://evil.test" },
    });
    expect((await api.handle(spoofed)).status).toBe(403);
    expect(
      (
        await api.handle(
          request("boards", { headers: { cookie: await login(), "sec-fetch-site": "cross-site" } }),
        )
      ).status,
    ).toBe(403);
    expect((await boards.snapshot("my game")).notes).toHaveLength(1);
  });

  it("allows only configured credentialed preflights and origin-specific responses", async () => {
    const response = await api.handle(
      request("boards", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": "PUT",
          "access-control-request-headers": "Authorization, Content-Type",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(
      (
        await api.handle(
          request("boards", {
            method: "OPTIONS",
            headers: { origin: ORIGIN, "access-control-request-headers": "x-untrusted" },
          }),
        )
      ).status,
    ).toBe(403);
    const unauthenticated = await api.handle(request("boards", { headers: { origin: ORIGIN } }));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  describe("behind one password", () => {
    const PASSWORD = "correct horse battery";
    let gated: ReturnType<typeof createApi>;
    beforeEach(() => {
      gated = createApi({
        boards,
        controllers,
        access: new ApiAccess({ ...SHARED, credentials: [BOB], password: PASSWORD }, () => now),
        compiler: { compile },
        recognizer: { read: recognize },
        beautifier: { beautify },
      });
    });
    const signIn = (password: unknown, peer = "203.0.113.7", headers: HeadersInit = {}) =>
      gated.handle(
        request("session", {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
          body: JSON.stringify({ password }),
        }),
        peer,
      );
    const session = async (cookie?: string) =>
      (
        await gated.handle(request("session", { headers: cookie === undefined ? {} : { cookie } }))
      ).json();

    it("asks for a password, refuses a wrong one and grants every board, controller and model for the right one", async () => {
      expect(await session()).toEqual({
        mode: "shared",
        authenticated: false,
        boards: [],
        controllers: [],
        secret: "password",
        unrestricted: false,
      });
      for (const wrong of ["correct horse", "", 42, "x".repeat(5000)]) {
        const refused = await signIn(wrong);
        expect(refused.status).toBe(401);
        expect(refused.headers.has("set-cookie")).toBe(false);
      }
      const accepted = await signIn(` ${PASSWORD} `);
      expect(accepted.status).toBe(200);
      const setCookie = accepted.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("HttpOnly; Secure; SameSite=Strict");
      expect(setCookie).toContain(`Max-Age=${SESSION_SECONDS}`);
      expect(setCookie).not.toContain(PASSWORD);
      const cookie = setCookie.split(";")[0] ?? "";
      expect(await session(cookie)).toMatchObject({ authenticated: true, unrestricted: true });
      controllers.report("arcade", { x: 0, y: 0, buttons: [] }, "http");
      const headers = { cookie, origin: ORIGIN };
      expect(await (await gated.handle(request("boards", { headers }))).json()).toEqual({
        boards: expect.arrayContaining([
          expect.objectContaining({ id: "my game" }),
          expect.objectContaining({ id: "private" }),
        ]),
      });
      for (const path of ["boards/private", "boards/never%20made", "controllers"]) {
        expect((await gated.handle(request(path, { headers }))).status).toBe(200);
      }
      expect(
        (
          await gated.handle(
            request("compile", {
              method: "POST",
              headers,
              body: JSON.stringify({ text: "gravity like mars" }),
            }),
          )
        ).status,
      ).toBe(200);
    });

    it("never takes the password as a bearer credential, and keeps scoped tokens working beside it", async () => {
      const asBearer = { authorization: `Bearer ${PASSWORD.replaceAll(" ", "-")}`, origin: ORIGIN };
      expect((await gated.handle(request("boards", { headers: asBearer }))).status).toBe(401);
      expect((await gated.handle(request("boards/private", { headers: bearer(BOB) }))).status).toBe(
        200,
      );
      expect(
        (await gated.handle(request("boards/my%20game", { headers: bearer(BOB) }))).status,
      ).toBe(403);
      expect(
        (
          await gated.handle(
            request("session", { method: "POST", headers: bearer(BOB) }),
            "203.0.113.7",
          )
        ).status,
      ).toBe(200);
    });

    it("makes one client wait out its window after ten wrong passwords, and no one else", async () => {
      for (let i = 0; i < 10; i++) expect((await signIn("guess")).status).toBe(401);
      const throttled = await signIn(PASSWORD);
      expect(throttled.status).toBe(429);
      expect(Number(throttled.headers.get("retry-after"))).toBe(15 * 60);
      expect((await signIn(PASSWORD, "198.51.100.2")).status).toBe(200);
      now += 15 * 60_000;
      expect((await signIn(PASSWORD)).status).toBe(200);
    });

    it("throttles the client a trusted proxy names, and ignores what an untrusted peer claims", async () => {
      const forwarded = (address: string) => ({ "x-forwarded-for": `10.9.9.9, ${address}` });
      for (let i = 0; i < 10; i++) {
        expect((await signIn("guess", "127.0.0.1", forwarded("203.0.113.9"))).status).toBe(401);
      }
      expect((await signIn(PASSWORD, "127.0.0.1", forwarded("203.0.113.9"))).status).toBe(429);
      expect((await signIn(PASSWORD, "127.0.0.1", forwarded("203.0.113.10"))).status).toBe(200);
      for (let i = 0; i < 10; i++) {
        expect((await signIn("guess", "192.0.2.1", forwarded(`198.51.100.${i}`))).status).toBe(401);
      }
      expect((await signIn(PASSWORD, "192.0.2.1", forwarded("198.51.100.99"))).status).toBe(429);
    });

    it("logs where a refused sign-in came from, so a host can find its proxy's address", async () => {
      const lines: string[] = [];
      const logged = createApi({
        boards,
        controllers,
        access: new ApiAccess(
          { ...SHARED, credentials: [BOB], password: PASSWORD },
          () => now,
          (line) => lines.push(line),
        ),
        compiler: { compile },
        recognizer: { read: recognize },
        beautifier: { beautify },
      });
      await logged.handle(
        request("session", {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.9",
          },
          body: JSON.stringify({ password: "guess" }),
        }),
        "127.0.0.1",
      );
      expect(lines).toEqual(["sign-in refused: connection from 127.0.0.1, counted as 203.0.113.9"]);
    });
  });
});

describe("model work budgets", () => {
  it("rejects oversized responses and returns the concurrent slot", async () => {
    const access = new ApiAccess({ ...DEMO_ACCESS, modelConcurrency: 1 });
    const response = await access.handle(
      request("beautify", { method: "POST" }),
      async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
    );
    expect(response.status).toBe(502);
    expect(
      (
        await access.handle(request("compile", { method: "POST" }), async () =>
          Response.json({ rule: null }),
        )
      ).status,
    ).toBe(200);
  });

  it("cancels stalled response bodies at the deadline and returns the concurrent slot", async () => {
    vi.useFakeTimers();
    try {
      const access = new ApiAccess({ ...DEMO_ACCESS, modelConcurrency: 1 });
      const cancel = vi.fn();
      const pending = access.handle(
        request("beautify", { method: "POST" }),
        async () => new Response(new ReadableStream({ cancel })),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pending).status).toBe(504);
      expect(cancel).toHaveBeenCalledOnce();
      expect(
        (
          await access.handle(request("compile", { method: "POST" }), async () =>
            Response.json({ rule: null }),
          )
        ).status,
      ).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["beautify", "transcribe"])(
    "bounds concurrent %s until response bodies finish and releases failures",
    async (path) => {
      const access = new ApiAccess({ ...DEMO_ACCESS, modelConcurrency: 1 });
      let finish: () => void = () => {};
      const pendingBody = new ReadableStream({
        start(controller) {
          finish = () => controller.close();
        },
      });
      const respond = vi.fn(async () => new Response(pendingBody));
      const first = access.handle(request(path, { method: "POST" }), respond);
      expect((await access.handle(request("compile", { method: "POST" }), respond)).status).toBe(
        429,
      );
      expect(respond).toHaveBeenCalledTimes(1);
      finish();
      expect((await first).status).toBe(200);
      await expect(
        access.handle(request("compile", { method: "POST" }), async () => {
          throw new Error("failed");
        }),
      ).rejects.toThrow("failed");
      expect(
        (
          await access.handle(request("compile", { method: "POST" }), async () =>
            Response.json({ rule: null }),
          )
        ).status,
      ).toBe(200);
    },
  );

  it("limits the aggregate model rate, leaves board access available and resets after a minute", async () => {
    let now = 100_000;
    const access = new ApiAccess({ ...DEMO_ACCESS, modelRequestsPerMinute: 2 }, () => now);
    const respond = vi.fn(async () => Response.json({ ok: true }));
    for (const path of ["recognize", "transcribe"]) {
      expect((await access.handle(request(path, { method: "POST" }), respond)).status).toBe(200);
    }
    const rejected = await access.handle(request("beautify", { method: "POST" }), respond);
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
    for (const path of ["compile", "compile//", "transcribe"]) {
      expect((await access.handle(request(path, { method: "POST" }), respond)).status).toBe(429);
    }
    expect((await access.handle(request("boards/my%20game"), respond)).status).toBe(200);
    now += 60_000;
    expect((await access.handle(request("compile", { method: "POST" }), respond)).status).toBe(200);
  });

  it("opens a stage to anyone same-origin in demo mode, and only to a board's own devices when shared", () => {
    const upgrade = (headers: HeadersInit = {}, method = "GET"): Request =>
      new Request("http://kami.test/api/stage/private?role=screen", { method, headers });
    const open = new ApiAccess();
    expect(open.openStage(upgrade(), "private")).not.toBeInstanceOf(Response);
    expect(open.openStage(upgrade({ origin: "https://evil.test" }), "private")).toBeInstanceOf(
      Response,
    );
    expect(open.openStage(upgrade({}, "POST"), "private")).toBeInstanceOf(Response);

    const shared = new ApiAccess(SHARED);
    const status = (headers: HeadersInit): number | null => {
      const answer = shared.openStage(upgrade(headers), "private");
      return answer instanceof Response ? answer.status : null;
    };
    expect(status({})).toBe(401);
    expect(status(bearer(ALICE))).toBe(403);
    expect(status(bearer(BOB))).toBeNull();
    const grant = shared.openStage(upgrade(bearer(BOB)), "private");
    expect(grant instanceof Response ? false : grant.authorized()).toBe(true);
  });
});
