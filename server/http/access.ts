import { type AccessConfig, type Credential, DEMO_ACCESS } from "./accessConfig";
import { badRequest, json, notFound, preflight } from "./responses";
import { Sessions } from "./sessions";
import { WorkLimit } from "./workLimit";

const MODEL_ROUTES = new Set(["recognize", "beautify", "compile", "transcribe"]);
const METHODS = "GET, PUT, POST, DELETE, OPTIONS";
const HEADERS = new Set(["content-type", "authorization"]);
const MODEL_BODY_TIMEOUT_MS = 30_000;
const MAX_MODEL_RESPONSE_BYTES = 8 * 1024 * 1024;

export type Respond = (request: Request) => Promise<Response>;

const denied = (): Response => json({ error: "access denied" }, 403);
const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: "authentication required" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
  });
const busy = (): Response =>
  new Response(JSON.stringify({ error: "request limit reached; try again later" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "60" },
  });

export class ApiAccess {
  readonly #sessions: Sessions;
  readonly #models: WorkLimit;
  readonly #logins: WorkLimit;

  constructor(
    private readonly config: AccessConfig = DEMO_ACCESS,
    now: () => number = Date.now,
  ) {
    this.#sessions = new Sessions(config.credentials, now);
    this.#models = new WorkLimit(config.modelRequestsPerMinute, config.modelConcurrency, now);
    this.#logins = new WorkLimit(30, 1, now);
  }

  scope(request: Request): Credential | null {
    return this.config.mode === "demo" ? null : this.#sessions.credential(request);
  }

  allowsController(request: Request, id: string): boolean {
    return this.config.mode === "demo" || (this.scope(request)?.controllers.includes(id) ?? false);
  }

  async handle(request: Request, respond: Respond): Promise<Response> {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    const allowedOrigin =
      origin !== null &&
      (this.config.origins.includes(origin) ||
        (this.config.mode === "demo" && origin === url.origin));
    if (
      (origin !== null && !allowedOrigin) ||
      (origin === null && request.headers.get("sec-fetch-site") === "cross-site")
    ) {
      return denied();
    }
    const response = await this.#handle(request, url, respond);
    response.headers.set("vary", "Origin");
    response.headers.set("cache-control", "no-store");
    if (allowedOrigin) {
      response.headers.set("access-control-allow-origin", origin);
      response.headers.set("access-control-allow-credentials", "true");
      response.headers.set("access-control-allow-methods", METHODS);
      response.headers.set("access-control-allow-headers", [...HEADERS].join(", "));
      response.headers.set("access-control-max-age", "600");
    }
    return response;
  }

  async #handle(request: Request, url: URL, respond: Respond): Promise<Response> {
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
    if (api !== "api") return notFound();
    if (resource === "session" && segments.length === 2) return this.#session(request);
    const scope = this.scope(request);
    if (this.config.mode === "shared") {
      if (scope === null) return unauthorized();
      if (!this.#permits(scope, resource, id)) return denied();
    }
    if (request.method !== "POST" || !MODEL_ROUTES.has(resource ?? "")) return respond(request);
    const release = this.#models.enter();
    if (release === null) return busy();
    try {
      const response = await respond(request);
      return await this.#bufferModelResponse(response);
    } finally {
      release();
    }
  }

  #permits(scope: Credential, resource?: string, id?: string): boolean {
    if (resource === "boards") return id === undefined || scope.boards.includes(id);
    if (resource === "controllers") return id === undefined || scope.controllers.includes(id);
    return resource !== undefined && MODEL_ROUTES.has(resource) && scope.models;
  }

  #session(request: Request): Response {
    if (request.method === "GET") {
      const scope = this.scope(request);
      return json({
        mode: this.config.mode,
        authenticated: this.config.mode === "demo" || scope !== null,
        boards: scope?.boards ?? [],
        controllers: scope?.controllers ?? [],
      });
    }
    if (request.method === "DELETE") {
      const response = json({ ok: true });
      response.headers.set("set-cookie", this.#sessions.clear(request));
      return response;
    }
    if (request.method !== "POST" || this.config.mode !== "shared") return notFound();
    const release = this.#logins.enter();
    if (release === null) return busy();
    try {
      const credential = this.#sessions.bearer(request);
      if (credential === null) return unauthorized();
      const cookie = this.#sessions.create(credential);
      if (cookie === null) return busy();
      const response = json({ ok: true });
      response.headers.set("set-cookie", cookie);
      return response;
    } finally {
      release();
    }
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
