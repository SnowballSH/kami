import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Credential } from "./accessConfig";

export const SESSION_SECONDS = 8 * 60 * 60;
const MAX_SESSIONS = 128;
const COOKIE = "__Host-kami";
const hash = (text: string): Buffer => createHash("sha256").update(text).digest();

interface Session {
  readonly credential: Credential;
  readonly expiresAt: number;
}

export class Sessions {
  readonly #sessions = new Map<string, Session>();
  readonly #credentials: readonly { credential: Credential; digest: Buffer }[];

  constructor(
    credentials: readonly Credential[],
    private readonly now: () => number = Date.now,
  ) {
    this.#credentials = credentials.map((credential) => ({
      credential,
      digest: hash(credential.token),
    }));
  }

  bearer(request: Request): Credential | null {
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9_-]{32,256}$/i.test(authorization)) return null;
    const digest = hash(authorization.slice(7));
    return (
      this.#credentials.find((entry) => timingSafeEqual(digest, entry.digest))?.credential ?? null
    );
  }

  credential(request: Request): Credential | null {
    if (request.headers.has("authorization")) return this.bearer(request);
    this.#expire();
    return this.#sessions.get(this.#cookie(request))?.credential ?? null;
  }

  create(credential: Credential): string | null {
    this.#expire();
    if (this.#sessions.size >= MAX_SESSIONS) return null;
    const id = randomBytes(32).toString("hex");
    this.#sessions.set(id, { credential, expiresAt: this.now() + SESSION_SECONDS * 1000 });
    return this.#header(id, SESSION_SECONDS);
  }

  clear(request: Request): string {
    this.#sessions.delete(this.#cookie(request));
    return this.#header("", 0);
  }

  #cookie(request: Request): string {
    return (
      request.headers
        .get("cookie")
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1) ?? ""
    );
  }

  #header(id: string, seconds: number): string {
    return `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
  }

  #expire(): void {
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= this.now()) this.#sessions.delete(id);
    }
  }
}
