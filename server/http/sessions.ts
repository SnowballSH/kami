import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type Credential, type Grant, MAX_PASSWORD_LENGTH, PASSWORD_GRANT } from "./accessConfig";

export const SESSION_SECONDS = 8 * 60 * 60;
const MAX_SESSIONS = 128;
const COOKIE = "__Host-kami";
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
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9_-]{32,256}$/i.test(authorization)) return null;
    return matchIn(this.#tokens, authorization.slice(7));
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

  create(grant: Grant): string | null {
    this.#expire();
    if (this.#sessions.size >= MAX_SESSIONS) return null;
    const id = randomBytes(32).toString("hex");
    this.#sessions.set(id, { grant, expiresAt: this.now() + SESSION_SECONDS * 1000 });
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
