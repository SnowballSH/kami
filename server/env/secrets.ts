import { readFileSync } from "node:fs";
import type { Env } from "./env";

/** Every variable that may carry a secret, and so may be given as `<NAME>_FILE` instead. */
export const SECRET_VARIABLES = [
  "KAMI_LLM_API_KEY",
  "KAMI_TRANSCRIBE_API_KEY",
  "KAMI_RECOGNIZER_API_KEY",
  "KAMI_BEAUTIFY_API_KEY",
  "MONGODB_URI",
  "KAMI_CREDENTIALS",
] as const;

export type SecretVariable = (typeof SECRET_VARIABLES)[number];

export type FileReader = (path: string) => string;

const FILE_SUFFIX = "_FILE";

const readFileText: FileReader = (path) => readFileSync(path, "utf8");

const secretFromFile = (name: string, path: string, readFile: FileReader): string => {
  try {
    return readFile(path).trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}${FILE_SUFFIX} names ${path}, which could not be read: ${reason}`);
  }
};

/**
 * Container secrets arrive as files (podman/docker `secrets`, systemd `LoadCredential`), so every
 * secret-bearing variable `X` may be given as `X_FILE` instead. The result is an environment in
 * which each `X` holds the value itself and no `X_FILE` remains, so nothing downstream knows the
 * difference. Setting both is a configuration error rather than a silent preference.
 */
export const resolveSecretFiles = (
  env: Env,
  readFile: FileReader = readFileText,
  names: readonly string[] = SECRET_VARIABLES,
): Env => {
  const resolved: Record<string, string | undefined> = { ...env };
  for (const name of names) {
    const fileVariable = `${name}${FILE_SUFFIX}`;
    const path = env[fileVariable]?.trim();
    if (path === undefined || path === "") continue;
    const inline = env[name];
    if (inline !== undefined && inline.trim() !== "") {
      throw new Error(`Set ${name} or ${fileVariable}, not both`);
    }
    resolved[name] = secretFromFile(name, path, readFile);
    delete resolved[fileVariable];
  }
  return resolved;
};
