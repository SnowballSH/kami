import { z } from "zod";
import { browserFetch, type FetchLike } from "./api";

const statusSchema = z.object({
  mode: z.enum(["demo", "shared"]),
  authenticated: z.boolean(),
  boards: z.array(z.string()),
  controllers: z.array(z.string()),
  /** What the access gate asks for; older servers leave it out and always want a token. */
  secret: z.enum(["password", "token"]).nullable().default(null),
  /** True when the grant covers every board and controller, so there is nothing to pick. */
  unrestricted: z.boolean().default(false),
});

export type SessionStatus = z.input<typeof statusSchema>;
export type ParsedSessionStatus = z.output<typeof statusSchema>;
export type SecretKind = "password" | "token";

/** What the game knows of its server once past the access gate. */
export interface Connection {
  /** False when the player chose to play without the server: nothing is saved or shared. */
  readonly online: boolean;
  /** Ends the session; present only when a shared server asked for a password or token. */
  readonly signOut?: () => Promise<void>;
}

export const OFFLINE: Connection = { online: false };
const SESSION_PATH = "/api/session";
const TIMEOUT_MS = 5000;

const retryHint = (response: Response): string => {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 60) return "Try again in a minute.";
  return `Try again in ${Math.ceil(seconds / 60)} minutes.`;
};

export class ApiSession {
  constructor(private readonly fetch: FetchLike = browserFetch) {}

  async status(): Promise<ParsedSessionStatus> {
    const response = await this.fetch(SESSION_PATH, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Cannot reach the Kami server. Please retry.");
    return statusSchema.parse(await response.json());
  }

  /** A token travels as a bearer header; a password, which may hold any character, in the body. */
  async signIn(secret: string, kind: SecretKind = "token"): Promise<void> {
    const response = await this.fetch(
      SESSION_PATH,
      kind === "password"
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: secret }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          }
        : {
            method: "POST",
            headers: { authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
    );
    if (response.ok) return;
    if (response.status === 429) {
      throw new Error(`Too many sign-in attempts. ${retryHint(response)}`);
    }
    throw new Error(
      kind === "password"
        ? "Wrong password. Check it and try again."
        : "Sign-in failed. Check your access token and try again.",
    );
  }

  async signOut(): Promise<void> {
    const response = await this.fetch(SESSION_PATH, {
      method: "DELETE",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("Sign-out failed. Please retry.");
  }
}
