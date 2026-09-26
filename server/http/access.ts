import { z } from "zod";
import { INPUT_LIMITS } from "../../src/core/inputLimits";
import {
  type AccessConfig,
  covers,
  DEMO_ACCESS,
  EVERY,
  type Grant,
  MAX_PASSWORD_LENGTH,
  type Scope,
  secretKindOf,
} from "./accessConfig";
import { clientOf, LoginThrottle } from "./loginThrottle";
import { badRequest, json, notFound, type Parsed, parseTextBody, preflight } from "./responses";
import { Sessions } from "./sessions";
import { WorkLimit } from "./workLimit";

const MODEL_ROUTES = new Map([
  ["/api/recognize", "POST"],
  ["/api/beautify", "POST"],
  ["/api/compile", "POST"],
  ["/api/transcribe", "POST"],
  ["/api/exemplar", "GET"],
  ["/api/exemplars", "GET"],
  ["/api/scene", "POST"],
]);
/** Answered before any session check in either mode: a container's liveness probe carries no cookie. */
export const HEALTH_PATH = "/api/health";
const METHODS = "GET, PUT, POST, DELETE, OPTIONS";
const HEADERS = new Set(["content-type", "authorization"]);
const MODEL_BODY_TIMEOUT_MS = 30_000;
const MAX_MODEL_RESPONSE_BYTES = 8 * 1024 * 1024;
/** A request body is read in full, within this long, before it may take a model or sign-in slot. */
const REQUEST_BODY_TIMEOUT_MS = 10_000;
const MAX_MODEL_REQUEST_BYTES = Math.max(INPUT_LIMITS.sketchBytes, INPUT_LIMITS.textBytes);
/** Room for a longest password written entirely as JSON `\uXXXX` escapes, plus its wrapper. */
const MAX_SIGN_IN_BODY_BYTES = MAX_PASSWORD_LENGTH * 8;
const passwordBodySchema = z.object({ password: z.string() });

export type Respond = (request: Request) => Promise<Response>;

/** A long-lived socket that does no model work; `authorized` is asked again for as long as it lives. */
export interface SocketGrant {
  readonly authorized: () => boolean;
}

const denied = (): Response => json({ error: "access denied" }, 403);
const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: "authentication required" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
const busy = (retryAfterSeconds = 60): Response =>
  new Response(JSON.stringify({ error: "request limit reached; try again later" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });
const listed = (scope: Scope | undefined): readonly string[] =>
  scope === undefined || scope === EVERY ? [] : scope;

type Presented =
  | { readonly kind: "bearer" }
  | { readonly kind: "password"; readonly candidate: string }
  | null;

/** The request again with its body already in memory, so a slow sender holds no slot while it trickles. */
const buffered = async (request: Request): Promise<Parsed<Request>> => {
  if (request.body === null) return { ok: true, value: request };
  const body = await parseTextBody(request, MAX_MODEL_REQUEST_BYTES, REQUEST_BODY_TIMEOUT_MS);
  if (!body.ok) return body;
  const { url, method, headers, signal } = request;
  return { ok: true, value: new Request(url, { method, headers, signal, body: body.value }) };
};

export class ApiAccess {
  readonly #sessions: Sessions;
  readonly #models: WorkLimit;
  readonly #logins: WorkLimit;
  readonly #failures: LoginThrottle;

  constructor(
    private readonly config: AccessConfig = DEMO_ACCESS,
    now: () => number = Date.now,
    private readonly log: (line: string) => void = () => {},
  ) {
    this.#sessions = new Sessions(config.credentials, config.password, now);
    this.#models = new WorkLimit(config.modelRequestsPerMinute, config.modelConcurrency, now);
    this.#logins = new WorkLimit(30, 1, now);
    this.#failures = new LoginThrottle(now);
  }

  scope(request: Request): Grant | null {
    return this.config.mode === "demo" ? null : this.#sessions.grant(request);
  }

  allowsBoard(request: Request, id: string): boolean {
    return this.#allows(request, "boards", id);
  }

  allowsController(request: Request, id: string): boolean {
    return this.#allows(request, "controllers", id);
  }

  visible<T extends { readonly id: string }>(
    request: Request,
    resource: "boards" | "controllers",
    items: readonly T[],
  ): readonly T[] {
    if (this.config.mode === "demo") return items;
    const scope = this.scope(request);
    return scope === null ? [] : items.filter(({ id }) => covers(scope[resource], id));
  }

  /** `peer` is the connection's remote address, by which failed sign-ins are throttled. */
  async handle(request: Request, respond: Respond, peer?: string): Promise<Response> {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    if (!this.#allowsOrigin(request)) return denied();
    const response = await this.#handle(request, url, respond, peer);
    response.headers.set("vary", "Origin");
    response.headers.set("cache-control", "no-store");
    if (origin !== null) {
      response.headers.set("access-control-allow-origin", origin);
      response.headers.set("access-control-allow-credentials", "true");
      response.headers.set("access-control-allow-methods", METHODS);
      response.headers.set("access-control-allow-headers", [...HEADERS].join(", "));
      response.headers.set("access-control-max-age", "600");
    }
    return response;
  }

  /**
   * A stage socket. Anyone same-origin in demo mode. When access is shared a stage shows a board's
   * play, so it is named after a board and open to the devices that may open that board.
   */
  openStage(request: Request, stage: string): SocketGrant | Response {
    if (!this.#allowsOrigin(request)) return denied();
    if (request.method !== "GET") return notFound();
    if (this.config.mode === "shared") {
      if (this.scope(request) === null) return unauthorized();
      if (!this.allowsBoard(request, stage)) return denied();
    }
    return { authorized: () => this.allowsBoard(request, stage) };
  }

  #allows(request: Request, resource: "boards" | "controllers", id: string): boolean {
    if (this.config.mode === "demo") return true;
    const scope = this.scope(request);
    return scope !== null && covers(scope[resource], id);
  }

  #allowsOrigin(request: Request): boolean {
    const origin = request.headers.get("origin");
    return origin === null
      ? request.headers.get("sec-fetch-site") !== "cross-site"
      : this.config.origins.includes(origin) ||
          (this.config.mode === "demo" && origin === new URL(request.url).origin);
  }

  async #handle(
    request: Request,
    url: URL,
    respond: Respond,
    peer: string | undefined,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      const headers = (request.headers.get("access-control-request-headers") ?? "")
        .toLowerCase()
        .split(",")
        .map((header) => header.trim())
        .filter(Boolean);
      return (method !== null && !METHODS.split(", ").includes(method)) ||
        headers.some((header) => !HEADERS.has(header))
        ? denied()
        : preflight();
    }
    let segments: string[];
    try {
      segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    } catch {
      return badRequest("malformed path");
    }
    const [api, resource, id] = segments;
    const path = `/${segments.join("/")}`;
    if (api !== "api") return notFound();
    if (path === HEALTH_PATH && request.method === "GET") return respond(request);
    if (resource === "session" && segments.length === 2) return this.#session(request, peer);
    const scope = this.scope(request);
    if (this.config.mode === "shared") {
      if (scope === null) return unauthorized();
      if (!this.#permits(scope, path, resource, id)) return denied();
    }
    if (MODEL_ROUTES.get(path) !== request.method) return respond(request);
    const read = await buffered(request);
    if (!read.ok) return read.response;
    const release = this.#models.enter();
    if (release === null) return busy();
    try {
      const response = await respond(read.value);
      return await this.#bufferModelResponse(response);
    } finally {
      release();
    }
  }

  #permits(scope: Grant, path: string, resource?: string, id?: string): boolean {
    if (resource === "boards") return id === undefined || covers(scope.boards, id);
    if (resource === "controllers") return id === undefined || covers(scope.controllers, id);
    return MODEL_ROUTES.has(path) && scope.models;
  }

  async #session(request: Request, peer: string | undefined): Promise<Response> {
    if (request.method === "GET") {
      const scope = this.scope(request);
      return json({
        mode: this.config.mode,
        authenticated: this.config.mode === "demo" || scope !== null,
        boards: listed(scope?.boards),
        controllers: listed(scope?.controllers),
        secret: secretKindOf(this.config),
        unrestricted:
          this.config.mode === "demo" || (scope?.boards === EVERY && scope.controllers === EVERY),
      });
    }
    if (request.method === "DELETE") {
      const response = json({ ok: true });
      response.headers.set("set-cookie", this.#sessions.clear(request));
      return response;
    }
    if (request.method !== "POST" || this.config.mode !== "shared") return notFound();
    const client = clientOf(request, peer, this.config.trustedProxies);
    const wait = this.#failures.waitSeconds(client);
    if (wait > 0) return busy(wait);
    const presented = await this.#presented(request);
    const release = this.#logins.enter();
    if (release === null) return busy();
    try {
      const grant = this.#verify(request, presented);
      if (grant === null) {
        this.#failures.fail(client);
        this.log(`sign-in refused: connection from ${peer ?? "unknown"}, counted as ${client}`);
        return unauthorized();
      }
      this.#failures.succeed(client);
      const cookie = this.#sessions.create(grant);
      if (cookie === null) return busy();
      const response = json({ ok: true });
      response.headers.set("set-cookie", cookie);
      return response;
    } finally {
      release();
    }
  }

  /** A bearer token in the header, or the shared password as `{ "password": … }` in the body. */
  async #presented(request: Request): Promise<Presented> {
    if (request.headers.has("authorization")) return { kind: "bearer" };
    if (this.config.password === null) return null;
    const text = await parseTextBody(request, MAX_SIGN_IN_BODY_BYTES, REQUEST_BODY_TIMEOUT_MS);
    if (!text.ok) return null;
    let body: unknown;
    try {
      body = JSON.parse(text.value);
    } catch {
      return null;
    }
    const parsed = passwordBodySchema.safeParse(body);
    return parsed.success ? { kind: "password", candidate: parsed.data.password } : null;
  }

  #verify(request: Request, presented: Presented): Grant | null {
    if (presented === null) return null;
    return presented.kind === "bearer"
      ? this.#sessions.bearer(request)
      : this.#sessions.password(presented.candidate);
  }

  async #bufferModelResponse(response: Response): Promise<Response> {
    if (response.body === null) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let timedOut = false;
    let bytes = 0;
    const timeout = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
    }, MODEL_BODY_TIMEOUT_MS);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (timedOut) return json({ error: "model response timed out" }, 504);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_MODEL_RESPONSE_BYTES) {
          await reader.cancel();
          return json({ error: "model response too large" }, 502);
        }
        chunks.push(new Uint8Array(value));
      }
      return new Response(new Blob(chunks), { status: response.status, headers: response.headers });
    } catch {
      return json({ error: "model response failed" }, 502);
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  }
}
