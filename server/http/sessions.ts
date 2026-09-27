import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type Credential,
  type Grant,
  grantWithin,
  MAX_PASSWORD_LENGTH,
  PASSWORD_GRANT,
} from "./accessConfig";

export const SESSION_SECONDS = 8 * 60 * 60;
export const MAX_SESSIONS = 128;
const COOKIE = "__Host-kami";
const BEARER = /^Bearer ([A-Za-z0-9_-]{32,256})$/i;
const hash = (text: string): Buffer => createHash("sha256").update(text).digest();

interface Session {
  readonly grant: Grant;
  readonly expiresAt: number;
}

interface Secret {
  readonly grant: Grant;
  readonly digest: Buffer;
}

/** Compares digests of equal length in constant time, and checks every secret so the count leaks nothing either. */
const matchIn = (secrets: readonly Secret[], candidate: string): Grant | null => {
  const digest = hash(candidate);
  let found: Grant | null = null;
  for (const secret of secrets) {
    if (timingSafeEqual(digest, secret.digest) && found === null) found = secret.grant;
  }
  return found;
};

export class Sessions {
  readonly #sessions = new Map<string, Session>();
  readonly #tokens: readonly Secret[];
  readonly #password: readonly Secret[];

  constructor(
    credentials: readonly Credential[],
    password: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.#tokens = credentials.map(({ token, ...grant }) => ({ grant, digest: hash(token) }));
    this.#password = password === null ? [] : [{ grant: PASSWORD_GRANT, digest: hash(password) }];
  }

  bearer(request: Request): Grant | null {
    const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
    return token === undefined ? null : matchIn(this.#tokens, token);
  }

  password(candidate: string): Grant | null {
    const trimmed = candidate.trim();
    if (trimmed === "" || trimmed.length > MAX_PASSWORD_LENGTH) return null;
    return matchIn(this.#password, trimmed);
  }

  grant(request: Request): Grant | null {
    if (request.headers.has("authorization")) return this.bearer(request);
    this.#expire();
    return this.#sessions.get(this.#cookie(request))?.grant ?? null;
  }

  /**
   * At capacity a session makes room: the oldest of the same grant, else the oldest whose grant this one
   * covers. A grant never ends a session it does not cover, so `null` — no session — when none is left.
   */
  create(grant: Grant): string | null {
    this.#expire();
    if (this.#sessions.size >= MAX_SESSIONS) {
      const evicted =
        this.#oldestWhere((held) => held.id === grant.id) ??
        this.#oldestWhere((held) => grantWithin(held, grant));
      if (evicted === undefined) return null;
      this.#sessions.delete(evicted);
    }
    const id = randomBytes(32).toString("hex");
    this.#sessions.set(id, { grant, expiresAt: this.now() + SESSION_SECONDS * 1000 });
    return this.#header(id, SESSION_SECONDS);
  }

  clear(request: Request): string {
    this.#sessions.delete(this.#cookie(request));
    return this.#header("", 0);
  }

  #oldestWhere(matches: (grant: Grant) => boolean): string | undefined {
    for (const [id, { grant }] of this.#sessions) if (matches(grant)) return id;
    return undefined;
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
