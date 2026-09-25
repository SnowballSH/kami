import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmConfig } from "./compile/llmCompiler";
import { AUTO_SERIAL_DEVICE, type ControllerTransportConfig } from "./controllers/types";
import { type DatabaseOptions, DEFAULT_EMBEDDED_CACHE_GB } from "./db/connect";
import {
  type Env,
  isOff,
  nonEmpty,
  nonNegativeIntegerFrom,
  portFrom,
  positiveNumberFrom,
} from "./env/env";
import { type FileReader, resolveSecretFiles } from "./env/secrets";
import { type AccessConfig, readAccessConfig } from "./http/accessConfig";
import type { AuthenticatedEndpoint } from "./http/endpoint";
import { parseReasoningEffort } from "./llm/chatClient";
import { sidecarUrl } from "./recognition/sidecarUrl";
import { type ManagedSidecarConfig, managedSidecarUrl } from "./sidecar/managed";

const DEFAULT_PORT = 8787;
const DEFAULT_CONTROLLER_UDP_PORT = 8788;
const DEFAULT_RECOGNIZER_THREADS = 1;
const DEFAULT_SIDECAR_PORT = 8790;
const EMBEDDED_DATA_DIRECTORY = fileURLToPath(new URL("../.kami-data", import.meta.url));
const QUICKDRAW_SNAPSHOT_NAME = "quickdraw.ndjson.gz";
const BUILT_WEB_DIRECTORY = fileURLToPath(new URL("../dist", import.meta.url));
const ML_DIRECTORY = fileURLToPath(new URL("../ml", import.meta.url));
const SIDECAR_MODES = ["auto", "off"] as const;

export interface ServerConfig {
  readonly hostname: string;
  readonly access: AccessConfig;
  readonly port: number;
  readonly tls: TlsConfig | null;
  readonly database: DatabaseOptions;
  readonly llm: LlmConfig | null;
  /** The vision model that reads handwriting when no local reader passes its check. */
  readonly transcribe: LlmConfig | null;
  /** The sidecar whose local models read handwriting (`POST /read`); preferred over `transcribe`. */
  readonly handwriting: AuthenticatedEndpoint | null;
  /** The sidecar the server starts and supervises itself (KAMI_SIDECAR=auto); null when off. */
  readonly sidecar: ManagedSidecarConfig | null;
  /** Ask the rules model one warm-up question at start-up; off spares a paid gateway the request. */
  readonly warmUp: boolean;
  /** The built game to serve alongside the API; null in development, where Vite serves it. */
  readonly webDirectory: string | null;
  /** Where the sketch-beautifier model listens (`POST {strokes, name}`); null until one is attached. */
  readonly beautifier: AuthenticatedEndpoint | null;
  /** Where the Kami's Eye sidecar listens (ml/CONTRACT.md); null means the built-in k-NN recognises alone. */
  readonly recognizer: AuthenticatedEndpoint | null;
  /** Worker threads ranking sketches for the built-in k-NN; 0 ranks on the event loop. */
  readonly recognizerThreads: number;
  /** The Quick, Draw! corpus the k-NN learns from: a gzipped NDJSON snapshot (`quickdraw/snapshotFile.ts`). */
  readonly quickdrawSnapshot: string;
  /** The Eye's exemplar set (ml/CONTRACT.md), whose drawings are summoned by name; null summons from Quick, Draw! itself. */
  readonly sketchesDirectory: string | null;
  /** How physical controllers reach the hub (docs/controllers.md); a `null` transport is switched off. */
  readonly controllers: ControllerTransportConfig;
}

export interface TlsConfig {
  readonly certFile: string;
  readonly keyFile: string;
  readonly port: number;
}

const tlsFrom = (env: Env): TlsConfig | null => {
  const certFile = nonEmpty(env.KAMI_TLS_CERT);
  const keyFile = nonEmpty(env.KAMI_TLS_KEY);
  if (certFile === undefined || keyFile === undefined) return null;
  return {
    certFile,
    keyFile,
    port: portFrom(env.KAMI_TLS_PORT, 8443),
  };
};

const controllersFrom = (env: Env, access: AccessConfig): ControllerTransportConfig => ({
  udpPort:
    access.mode === "shared" || isOff(env.KAMI_CONTROLLER_UDP_PORT)
      ? null
      : portFrom(env.KAMI_CONTROLLER_UDP_PORT, DEFAULT_CONTROLLER_UDP_PORT),
  serialDevice: isOff(env.KAMI_CONTROLLER_SERIAL)
    ? null
    : (nonEmpty(env.KAMI_CONTROLLER_SERIAL) ?? AUTO_SERIAL_DEVICE),
});

interface ModelVariables {
  readonly url: string;
  readonly model: string;
  readonly apiKey: string;
  readonly reasoningEffort: string;
}

const LLM_VARIABLES: ModelVariables = {
  url: "KAMI_LLM_URL",
  model: "KAMI_LLM_MODEL",
  apiKey: "KAMI_LLM_API_KEY",
  reasoningEffort: "KAMI_LLM_REASONING_EFFORT",
};

const TRANSCRIBE_VARIABLES: ModelVariables = {
  url: "KAMI_TRANSCRIBE_URL",
  model: "KAMI_TRANSCRIBE_MODEL",
  apiKey: "KAMI_TRANSCRIBE_API_KEY",
  reasoningEffort: "KAMI_TRANSCRIBE_REASONING_EFFORT",
};

/** Reads one model's variables, each falling back to the rules model's when `fallback` is given. */
const modelFrom = (
  env: Env,
  variables: ModelVariables,
  fallback: ModelVariables | null = null,
): LlmConfig | null => {
  const read = (key: keyof ModelVariables): string | undefined =>
    nonEmpty(env[variables[key]]) ?? (fallback === null ? undefined : nonEmpty(env[fallback[key]]));
  const url = read("url");
  const model = read("model");
  if (url === undefined || model === undefined) return null;
  const apiKey = read("apiKey");
  const effortVariable =
    nonEmpty(env[variables.reasoningEffort]) === undefined && fallback !== null
      ? fallback.reasoningEffort
      : variables.reasoningEffort;
  const effort = nonEmpty(env[effortVariable]);
  return {
    url,
    model,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(effort === undefined
      ? {}
      : { reasoningEffort: parseReasoningEffort(effort, effortVariable) }),
  };
};

const webDirectoryFrom = (env: Env): string | null => {
  const directory = nonEmpty(env.KAMI_WEB_DIR) ?? BUILT_WEB_DIRECTORY;
  return existsSync(directory) ? directory : null;
};

const endpointOf = (url: string, apiKey: string | undefined): AuthenticatedEndpoint =>
  apiKey === undefined ? { url } : { url, apiKey };

const positiveIntegerOrNull = (env: Env, name: string): number | null => {
  const raw = nonEmpty(env[name]);
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, not "${raw}"`);
  }
  return value;
};

const pythonOfTheSidecar = (): string => {
  const venv = join(ML_DIRECTORY, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
};

/** `KAMI_SIDECAR=auto` starts ml/sidecar.py beside the server (the image's default); off by default. */
const managedSidecarFrom = (env: Env): ManagedSidecarConfig | null => {
  const mode = (nonEmpty(env.KAMI_SIDECAR) ?? "off").toLowerCase();
  if (!(SIDECAR_MODES as readonly string[]).includes(mode)) {
    throw new Error(
      `KAMI_SIDECAR must be ${SIDECAR_MODES.join(" or ")}, not "${env.KAMI_SIDECAR}"`,
    );
  }
  if (mode === "off") return null;
  return {
    python: nonEmpty(env.KAMI_SIDECAR_PYTHON) ?? pythonOfTheSidecar(),
    script: join(ML_DIRECTORY, "sidecar.py"),
    port: portFrom(env.KAMI_SIDECAR_PORT, DEFAULT_SIDECAR_PORT),
    threads: positiveIntegerOrNull(env, "KAMI_EYE_THREADS"),
    eyeModel: nonEmpty(env.KAMI_EYE_MODEL) ?? join(ML_DIRECTORY, "artifacts", "kami-eye"),
    handwritingModel:
      nonEmpty(env.KAMI_HANDWRITING_MODEL) ?? join(ML_DIRECTORY, "models", "handwriting"),
  };
};

/**
 * KAMI_RECOGNIZER_URL, or the managed sidecar when it has an Eye to serve (a model at
 * KAMI_EYE_MODEL); `off` keeps the k-NN alone either way.
 */
const recognizerFrom = (
  env: Env,
  sidecar: ManagedSidecarConfig | null,
): AuthenticatedEndpoint | null => {
  const url = nonEmpty(env.KAMI_RECOGNIZER_URL);
  if (isOff(url)) return null;
  if (url !== undefined) return endpointOf(url, nonEmpty(env.KAMI_RECOGNIZER_API_KEY));
  return sidecar !== null && existsSync(sidecar.eyeModel)
    ? { url: managedSidecarUrl(sidecar) }
    : null;
};

/**
 * Whose `/read` reads handwriting: KAMI_HANDWRITING_URL, else the managed sidecar, else the
 * recogniser's sidecar (with its key); `off` leaves handwriting to the vision model alone.
 */
const handwritingFrom = (
  env: Env,
  sidecar: ManagedSidecarConfig | null,
  recognizer: AuthenticatedEndpoint | null,
): AuthenticatedEndpoint | null => {
  const configured = nonEmpty(env.KAMI_HANDWRITING_URL);
  if (isOff(configured)) return null;
  const apiKey = nonEmpty(env.KAMI_HANDWRITING_API_KEY);
  if (configured !== undefined) return endpointOf(configured, apiKey);
  if (sidecar !== null) return { url: managedSidecarUrl(sidecar) };
  return recognizer === null ? null : endpointOf(recognizer.url, apiKey ?? recognizer.apiKey);
};

/**
 * The Eye sidecar serves `/complete` next to `/recognize` (ml/CONTRACT.md), so an unset beautifier
 * follows the recogniser, key included; `off` keeps the player's own ink.
 */
const beautifierFrom = (
  env: Env,
  recognizer: AuthenticatedEndpoint | null,
): AuthenticatedEndpoint | null => {
  const configured = nonEmpty(env.KAMI_BEAUTIFY_URL);
  if (isOff(configured)) return null;
  const apiKey = nonEmpty(env.KAMI_BEAUTIFY_API_KEY);
  if (configured !== undefined) return endpointOf(configured, apiKey);
  if (recognizer === null) return null;
  return endpointOf(sidecarUrl(recognizer.url, "complete"), apiKey ?? recognizer.apiKey);
};

export const readConfig = (
  rawEnv: Env = process.env,
  readSecretFile?: FileReader,
): ServerConfig => {
  const env = resolveSecretFiles(rawEnv, readSecretFile);
  const access = readAccessConfig(env);
  const sidecar = managedSidecarFrom(env);
  const recognizer = recognizerFrom(env, sidecar);
  const embeddedDataDirectory = nonEmpty(env.KAMI_DATA_DIR) ?? EMBEDDED_DATA_DIRECTORY;
  return {
    hostname: nonEmpty(env.KAMI_BIND_HOST) ?? (access.mode === "shared" ? "127.0.0.1" : "0.0.0.0"),
    access,
    port: portFrom(env.PORT, DEFAULT_PORT),
    tls: tlsFrom(env),
    database: {
      uri: nonEmpty(env.MONGODB_URI),
      embeddedDataDirectory,
      embeddedCacheGb: positiveNumberFrom(env.KAMI_MONGO_CACHE_GB, DEFAULT_EMBEDDED_CACHE_GB),
    },
    llm: modelFrom(env, LLM_VARIABLES),
    transcribe: modelFrom(env, TRANSCRIBE_VARIABLES, LLM_VARIABLES),
    handwriting: handwritingFrom(env, sidecar, recognizer),
    sidecar,
    warmUp: !isOff(env.KAMI_LLM_WARM_UP),
    webDirectory: webDirectoryFrom(env),
    beautifier: beautifierFrom(env, recognizer),
    recognizer,
    recognizerThreads: nonNegativeIntegerFrom(
      env.KAMI_RECOGNIZER_THREADS,
      DEFAULT_RECOGNIZER_THREADS,
    ),
    quickdrawSnapshot:
      nonEmpty(env.KAMI_QUICKDRAW_SNAPSHOT) ?? join(embeddedDataDirectory, QUICKDRAW_SNAPSHOT_NAME),
    sketchesDirectory: nonEmpty(env.KAMI_SKETCHES) ?? null,
    controllers: controllersFrom(env, access),
  };
};
