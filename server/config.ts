import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LlmConfig } from "./compile/llmCompiler";
import { AUTO_SERIAL_DEVICE, type ControllerTransportConfig } from "./controllers/types";
import type { DatabaseOptions } from "./db/connect";
import type { VoiceConfig } from "./voice/types";

const DEFAULT_PORT = 8787;
const DEFAULT_CONTROLLER_UDP_PORT = 8788;
const OFF = "off";
const EMBEDDED_DATA_DIRECTORY = fileURLToPath(new URL("../.kami-data", import.meta.url));
const BUILT_WEB_DIRECTORY = fileURLToPath(new URL("../dist", import.meta.url));

export interface ServerConfig {
  readonly port: number;
  readonly database: DatabaseOptions;
  readonly llm: LlmConfig | null;
  readonly transcribe: LlmConfig | null;
  /** The built game to serve alongside the API; null in development, where Vite serves it. */
  readonly webDirectory: string | null;
  /** Where the sketch-beautifier model listens (`POST {strokes, name}`); null until one is attached. */
  readonly beautifyUrl: string | null;
  /** Where the Kami's Eye sidecar listens (ml/CONTRACT.md); null means the built-in k-NN recognises alone. */
  readonly recognizerUrl: string | null;
  /** How physical controllers reach the hub (docs/controllers.md); a `null` transport is switched off. */
  readonly controllers: ControllerTransportConfig;
  /** Deepgram, for hearing the player and giving Kami a voice (docs/voice.md); null keeps him silent. */
  readonly voice: VoiceConfig | null;
}

type Env = Readonly<Record<string, string | undefined>>;

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value.trim();

const portFrom = (value: string | undefined, fallback: number): number => {
  const port = Number(nonEmpty(value));
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

const isOff = (value: string | undefined): boolean => nonEmpty(value)?.toLowerCase() === OFF;

const controllersFrom = (env: Env): ControllerTransportConfig => ({
  udpPort: isOff(env.KAMI_CONTROLLER_UDP_PORT)
    ? null
    : portFrom(env.KAMI_CONTROLLER_UDP_PORT, DEFAULT_CONTROLLER_UDP_PORT),
  serialDevice: isOff(env.KAMI_CONTROLLER_SERIAL)
    ? null
    : (nonEmpty(env.KAMI_CONTROLLER_SERIAL) ?? AUTO_SERIAL_DEVICE),
});

const llmFrom = (env: Env): LlmConfig | null => {
  const url = nonEmpty(env.KAMI_LLM_URL);
  const model = nonEmpty(env.KAMI_LLM_MODEL);
  const apiKey = nonEmpty(env.KAMI_LLM_API_KEY);
  if (url === undefined || model === undefined) return null;
  return apiKey === undefined ? { url, model } : { url, model, apiKey };
};

const DEFAULT_LISTEN_MODEL = "nova-3";
const DEFAULT_SPEAK_MODEL = "aura-2-draco-en";

const voiceFrom = (env: Env): VoiceConfig | null => {
  const apiKey = nonEmpty(env.DEEPGRAM_API_KEY);
  if (apiKey === undefined) return null;
  return {
    apiKey,
    listenModel: nonEmpty(env.KAMI_VOICE_LISTEN_MODEL) ?? DEFAULT_LISTEN_MODEL,
    speakModel: nonEmpty(env.KAMI_VOICE_SPEAK_MODEL) ?? DEFAULT_SPEAK_MODEL,
  };
};

const webDirectoryFrom = (env: Env): string | null => {
  const directory = nonEmpty(env.KAMI_WEB_DIR) ?? BUILT_WEB_DIRECTORY;
  return existsSync(directory) ? directory : null;
};

export const readConfig = (env: Env = process.env): ServerConfig => ({
  port: portFrom(env.PORT, DEFAULT_PORT),
  database: { uri: nonEmpty(env.MONGODB_URI), embeddedDataDirectory: EMBEDDED_DATA_DIRECTORY },
  llm: llmFrom(env),
  transcribe: llmFrom({
    ...env,
    KAMI_LLM_MODEL: nonEmpty(env.KAMI_TRANSCRIBE_MODEL) ?? env.KAMI_LLM_MODEL,
  }),
  webDirectory: webDirectoryFrom(env),
  beautifyUrl: nonEmpty(env.KAMI_BEAUTIFY_URL) ?? null,
  recognizerUrl: nonEmpty(env.KAMI_RECOGNIZER_URL) ?? null,
  controllers: controllersFrom(env),
  voice: voiceFrom(env),
});
