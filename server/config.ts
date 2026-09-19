import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LlmConfig } from "./compile/llmCompiler";
import type { DatabaseOptions } from "./db/connect";

const DEFAULT_PORT = 8787;
const EMBEDDED_DATA_DIRECTORY = fileURLToPath(new URL("../.kami-data", import.meta.url));
const BUILT_WEB_DIRECTORY = fileURLToPath(new URL("../dist", import.meta.url));

export interface ServerConfig {
  readonly port: number;
  readonly database: DatabaseOptions;
  readonly llm: LlmConfig | null;
  /** The built game to serve alongside the API; null in development, where Vite serves it. */
  readonly webDirectory: string | null;
  /** Where the sketch-beautifier model listens (`POST {strokes, name}`); null until one is attached. */
  readonly beautifyUrl: string | null;
  /** Where the Kami's Eye sidecar listens (ml/CONTRACT.md); null means the built-in k-NN recognises alone. */
  readonly recognizerUrl: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value.trim();

const portFrom = (value: string | undefined): number => {
  const port = Number(nonEmpty(value));
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
};

const llmFrom = (env: Env): LlmConfig | null => {
  const url = nonEmpty(env.KAMI_LLM_URL);
  const model = nonEmpty(env.KAMI_LLM_MODEL);
  const apiKey = nonEmpty(env.KAMI_LLM_API_KEY);
  if (url === undefined || model === undefined) return null;
  return apiKey === undefined ? { url, model } : { url, model, apiKey };
};

const webDirectoryFrom = (env: Env): string | null => {
  const directory = nonEmpty(env.KAMI_WEB_DIR) ?? BUILT_WEB_DIRECTORY;
  return existsSync(directory) ? directory : null;
};

export const readConfig = (env: Env = process.env): ServerConfig => ({
  port: portFrom(env.PORT),
  database: { uri: nonEmpty(env.MONGODB_URI), embeddedDataDirectory: EMBEDDED_DATA_DIRECTORY },
  llm: llmFrom(env),
  webDirectory: webDirectoryFrom(env),
  beautifyUrl: nonEmpty(env.KAMI_BEAUTIFY_URL) ?? null,
  recognizerUrl: nonEmpty(env.KAMI_RECOGNIZER_URL) ?? null,
});
