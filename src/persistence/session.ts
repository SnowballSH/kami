import { z } from "zod";
import { browserFetch, type FetchLike } from "./api";

const statusSchema = z.object({
  mode: z.enum(["demo", "shared"]),
  authenticated: z.boolean(),
  boards: z.array(z.string()),
  controllers: z.array(z.string()),
});

export type SessionStatus = z.infer<typeof statusSchema>;
const SESSION_PATH = "/api/session";

export class ApiSession {
  constructor(private readonly fetch: FetchLike = browserFetch) {}

  async status(): Promise<SessionStatus> {
    const response = await this.fetch(SESSION_PATH, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Cannot reach the Kami server. Please retry.");
    return statusSchema.parse(await response.json());
  }

  async signIn(token: string): Promise<void> {
    const response = await this.fetch(SESSION_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 429
          ? "Too many sign-in attempts. Try again in a minute."
          : "Sign-in failed. Check your access token and try again.",
      );
    }
  }

  async signOut(): Promise<void> {
    const response = await this.fetch(SESSION_PATH, {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Sign-out failed. Please retry.");
  }
}
