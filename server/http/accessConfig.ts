import { z } from "zod";
import { boardIdSchema } from "../schemas";

const credentialSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  boards: z.array(boardIdSchema).max(100),
  controllers: z.array(z.string().regex(/^[a-z0-9-]{1,32}$/)).max(100),
  models: z.boolean(),
});

export type Credential = z.infer<typeof credentialSchema>;

export interface AccessConfig {
  readonly mode: "demo" | "shared";
  readonly origins: readonly string[];
  readonly credentials: readonly Credential[];
  readonly modelRequestsPerMinute: number;
  readonly modelConcurrency: number;
}

export const DEMO_ACCESS: AccessConfig = {
  mode: "demo",
  origins: [],
  credentials: [],
  modelRequestsPerMinute: 600,
  modelConcurrency: 4,
};

type Env = Readonly<Record<string, string | undefined>>;

const positiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Invalid API work limit");
  return parsed;
};

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

export const readAccessConfig = (env: Env): AccessConfig => {
  const mode = env.KAMI_ACCESS_MODE ?? "demo";
  if (mode !== "demo" && mode !== "shared") throw new Error("Invalid KAMI_ACCESS_MODE");
  const origins = (env.KAMI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(originOf);
  let credentials: Credential[] = [];
  if (mode === "shared") {
    try {
      credentials = z
        .array(credentialSchema)
        .min(1)
        .max(100)
        .parse(JSON.parse(env.KAMI_CREDENTIALS ?? ""));
    } catch {
      throw new Error("Shared mode requires valid KAMI_CREDENTIALS; see server/README.md");
    }
    if (
      new Set(credentials.map(({ id }) => id)).size !== credentials.length ||
      new Set(credentials.map(({ token }) => token)).size !== credentials.length
    ) {
      throw new Error("Shared credentials must have distinct ids and tokens");
    }
    if (origins.length === 0 || origins.some((origin) => !origin.startsWith("https://"))) {
      throw new Error("Shared mode requires explicit HTTPS KAMI_ALLOWED_ORIGINS");
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
    modelRequestsPerMinute: positiveInteger(
      env.KAMI_MODEL_REQUESTS_PER_MINUTE,
      DEMO_ACCESS.modelRequestsPerMinute,
    ),
    modelConcurrency: positiveInteger(env.KAMI_MODEL_CONCURRENCY, DEMO_ACCESS.modelConcurrency),
  };
};
