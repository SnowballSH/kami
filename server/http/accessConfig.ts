import { isIP } from "node:net";
import { z } from "zod";
import { boardIdSchema } from "../schemas";

/** Every board or controller, present and future: what the shared password grants. */
export const EVERY = "*";

export type Scope = typeof EVERY | readonly string[];

/** What one secret lets its holder reach. */
export interface Grant {
  readonly id: string;
  readonly boards: Scope;
  readonly controllers: Scope;
  readonly models: boolean;
}

const credentialSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  boards: z.array(boardIdSchema).max(100),
  controllers: z.array(z.string().regex(/^[a-z0-9-]{1,32}$/)).max(100),
  models: z.boolean(),
});

export type Credential = z.infer<typeof credentialSchema>;

export const PASSWORD_GRANT: Grant = {
  id: "password",
  boards: EVERY,
  controllers: EVERY,
  models: true,
};

export const MAX_PASSWORD_LENGTH = 1024;

export const covers = (scope: Scope, id: string): boolean => scope === EVERY || scope.includes(id);

/** The secret a person types at the access gate. */
export type SecretKind = "password" | "token";

export interface AccessConfig {
  readonly mode: "demo" | "shared";
  readonly origins: readonly string[];
  readonly credentials: readonly Credential[];
  /** The one shared password (`KAMI_PASSWORD`), granting everything; `null` when unset. */
  readonly password: string | null;
  /** Peers whose `X-Forwarded-For` names the client, for sign-in throttling only. */
  readonly trustedProxies: readonly string[];
  readonly modelRequestsPerMinute: number;
  readonly modelConcurrency: number;
}

export const DEMO_ACCESS: AccessConfig = {
  mode: "demo",
  origins: [],
  credentials: [],
  password: null,
  trustedProxies: ["127.0.0.1", "::1"],
  modelRequestsPerMinute: 6000,
  modelConcurrency: 32,
};

/** What the access gate asks for: `null` when the server asks for nothing. */
export const secretKindOf = (config: AccessConfig): SecretKind | null => {
  if (config.mode === "demo") return null;
  return config.password === null ? "token" : "password";
};

/** One line for the start-up log; never the secrets themselves. */
export const describeAccess = (config: AccessConfig): string => {
  if (config.mode === "demo") return "demo (every peer that can reach the server is trusted)";
  const gates = [
    ...(config.password === null ? [] : ["one password"]),
    ...(config.credentials.length === 0 ? [] : [`${config.credentials.length} token(s)`]),
  ];
  return `shared, signed in with ${gates.join(" or ")}; origins ${config.origins.join(", ")}`;
};

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const positiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Invalid API work limit");
  return parsed;
};

const listOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const originOf = (value: string): string => {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("KAMI_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
  }
  return url.origin;
};

/** Browsers treat loopback pages as secure, so they keep `Secure` cookies there over plain HTTP. */
const isSecureOrigin = (origin: string): boolean => {
  const url = new URL(origin);
  return url.protocol === "https:" || LOOPBACK_HOSTS.has(url.hostname);
};

const proxyOf = (value: string): string => {
  if (isIP(value) === 0) throw new Error("KAMI_TRUSTED_PROXIES must contain IP addresses");
  return value;
};

const passwordOf = (env: Env): string | null => {
  const password = env.KAMI_PASSWORD?.trim() ?? "";
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`KAMI_PASSWORD may be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  return password === "" ? null : password;
};

const modeOf = (env: Env, password: string | null): AccessConfig["mode"] => {
  const mode = env.KAMI_ACCESS_MODE?.trim() || (password === null ? "demo" : "shared");
  if (mode !== "demo" && mode !== "shared") throw new Error("Invalid KAMI_ACCESS_MODE");
  if (mode === "demo" && password !== null) {
    throw new Error("KAMI_PASSWORD gates a shared server; remove KAMI_ACCESS_MODE=demo");
  }
  return mode;
};

const credentialsOf = (env: Env, password: string | null): Credential[] => {
  const json = env.KAMI_CREDENTIALS?.trim() ?? "";
  if (password !== null && json === "") return [];
  let credentials: Credential[];
  try {
    credentials = z.array(credentialSchema).min(1).max(100).parse(JSON.parse(json));
  } catch {
    throw new Error(
      "Shared mode requires KAMI_PASSWORD or valid KAMI_CREDENTIALS; see server/README.md",
    );
  }
  const ids = credentials.map(({ id }) => id);
  const secrets = credentials.map(({ token }) => token);
  if (password !== null) {
    ids.push(PASSWORD_GRANT.id);
    secrets.push(password);
  }
  if (new Set(ids).size !== ids.length || new Set(secrets).size !== secrets.length) {
    throw new Error(
      `Shared credentials must have distinct ids (not "${PASSWORD_GRANT.id}" beside KAMI_PASSWORD) and secrets`,
    );
  }
  return credentials;
};

export const readAccessConfig = (env: Env): AccessConfig => {
  const password = passwordOf(env);
  const mode = modeOf(env, password);
  const origins = listOf(env.KAMI_ALLOWED_ORIGINS).map(originOf);
  const trustedProxies =
    env.KAMI_TRUSTED_PROXIES === undefined
      ? DEMO_ACCESS.trustedProxies
      : listOf(env.KAMI_TRUSTED_PROXIES).map(proxyOf);
  const credentials = mode === "shared" ? credentialsOf(env, password) : [];
  if (mode === "shared") {
    if (origins.length === 0 || !origins.every(isSecureOrigin)) {
      throw new Error("Shared mode requires explicit HTTPS (or loopback) KAMI_ALLOWED_ORIGINS");
    }
    if (
      env.KAMI_CONTROLLER_UDP_PORT !== undefined &&
      env.KAMI_CONTROLLER_UDP_PORT.trim().toLowerCase() !== "off"
    ) {
      throw new Error("Unauthenticated controller UDP must be off in shared mode");
    }
  }
  return {
    mode,
    origins,
    credentials,
    password,
    trustedProxies,
    modelRequestsPerMinute: positiveInteger(
      env.KAMI_MODEL_REQUESTS_PER_MINUTE,
      DEMO_ACCESS.modelRequestsPerMinute,
    ),
    modelConcurrency: positiveInteger(env.KAMI_MODEL_CONCURRENCY, DEMO_ACCESS.modelConcurrency),
  };
};
