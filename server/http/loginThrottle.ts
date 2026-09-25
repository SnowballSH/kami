const FAILURES_ALLOWED = 10;
const WINDOW_MS = 15 * 60_000;
const MAX_CLIENTS = 10_000;
const UNKNOWN_CLIENT = "unknown";

interface Failures {
  count: number;
  readonly windowEnd: number;
}

/**
 * Who is signing in, for throttling only: the peer's address, or the address a trusted proxy
 * appended last to `X-Forwarded-For` (the one hop no client can forge through that proxy).
 */
export const clientOf = (
  request: Request,
  peer: string | undefined,
  trustedProxies: readonly string[],
): string => {
  if (peer === undefined) return UNKNOWN_CLIENT;
  if (!trustedProxies.includes(peer)) return peer;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded === undefined || forwarded === "" ? peer : forwarded;
};

/** Failed sign-ins per client in a fixed window: past the allowance, that client waits it out. */
export class LoginThrottle {
  readonly #clients = new Map<string, Failures>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly allowed: number = FAILURES_ALLOWED,
    private readonly windowMs: number = WINDOW_MS,
  ) {}

  /** Seconds the client must wait before another attempt; 0 when it may try now. */
  waitSeconds(client: string): number {
    const failures = this.#current(client);
    if (failures === undefined || failures.count < this.allowed) return 0;
    return Math.ceil((failures.windowEnd - this.now()) / 1000);
  }

  fail(client: string): void {
    const failures = this.#current(client);
    if (failures !== undefined) {
      failures.count++;
      return;
    }
    this.#makeRoom();
    this.#clients.set(client, { count: 1, windowEnd: this.now() + this.windowMs });
  }

  succeed(client: string): void {
    this.#clients.delete(client);
  }

  #current(client: string): Failures | undefined {
    const failures = this.#clients.get(client);
    if (failures === undefined || failures.windowEnd > this.now()) return failures;
    this.#clients.delete(client);
    return undefined;
  }

  #makeRoom(): void {
    if (this.#clients.size < MAX_CLIENTS) return;
    for (const [client, failures] of this.#clients) {
      if (failures.windowEnd <= this.now()) this.#clients.delete(client);
    }
    const oldest = this.#clients.keys().next();
    if (this.#clients.size >= MAX_CLIENTS && oldest.done !== true) {
      this.#clients.delete(oldest.value);
    }
  }
}
