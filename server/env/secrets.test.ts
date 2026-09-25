// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveSecretFiles, SECRET_VARIABLES } from "./secrets";

const files: Record<string, string> = {
  "/run/secrets/llm": "  sk-from-file\n",
  "/run/secrets/mongo": "mongodb://user:pw@db/kami\n",
};
const readFile = (path: string): string => {
  const content = files[path];
  if (content === undefined) throw new Error("ENOENT: no such file");
  return content;
};

describe("resolveSecretFiles", () => {
  it("reads each secret from its _FILE, trimmed, and forgets the path", () => {
    const env = resolveSecretFiles(
      { KAMI_LLM_API_KEY_FILE: "/run/secrets/llm", MONGODB_URI_FILE: "/run/secrets/mongo" },
      readFile,
    );
    expect(env.KAMI_LLM_API_KEY).toBe("sk-from-file");
    expect(env.MONGODB_URI).toBe("mongodb://user:pw@db/kami");
    expect(env).not.toHaveProperty("KAMI_LLM_API_KEY_FILE");
    expect(env).not.toHaveProperty("MONGODB_URI_FILE");
  });

  it("leaves plain values and unrelated variables alone", () => {
    const env = resolveSecretFiles({ KAMI_LLM_API_KEY: "inline", PORT: "8799" }, readFile);
    expect(env).toEqual({ KAMI_LLM_API_KEY: "inline", PORT: "8799" });
  });

  it("refuses a secret given both ways", () => {
    expect(() =>
      resolveSecretFiles(
        { KAMI_LLM_API_KEY: "inline", KAMI_LLM_API_KEY_FILE: "/run/secrets/llm" },
        readFile,
      ),
    ).toThrow("Set KAMI_LLM_API_KEY or KAMI_LLM_API_KEY_FILE, not both");
  });

  it("treats an empty inline value as unset next to a _FILE", () => {
    expect(
      resolveSecretFiles(
        { KAMI_LLM_API_KEY: " ", KAMI_LLM_API_KEY_FILE: "/run/secrets/llm" },
        readFile,
      ).KAMI_LLM_API_KEY,
    ).toBe("sk-from-file");
  });

  it("fails start-up on an unreadable file, naming the variable and the path", () => {
    expect(() =>
      resolveSecretFiles({ KAMI_CREDENTIALS_FILE: "/run/secrets/missing" }, readFile),
    ).toThrow(/KAMI_CREDENTIALS_FILE names \/run\/secrets\/missing.*ENOENT/);
  });

  it("covers every key, the database URI, the shared credentials and the password", () => {
    expect([...SECRET_VARIABLES]).toEqual([
      "KAMI_LLM_API_KEY",
      "KAMI_TRANSCRIBE_API_KEY",
      "KAMI_RECOGNIZER_API_KEY",
      "KAMI_HANDWRITING_API_KEY",
      "KAMI_BEAUTIFY_API_KEY",
      "MONGODB_URI",
      "KAMI_CREDENTIALS",
      "KAMI_PASSWORD",
    ]);
  });

  it("reads the shared password from a file, without its trailing newline", () => {
    const readFile = (path: string): string => (path === "/run/secrets/kami" ? "hunter22\n" : "");
    expect(resolveSecretFiles({ KAMI_PASSWORD_FILE: "/run/secrets/kami" }, readFile)).toEqual({
      KAMI_PASSWORD: "hunter22",
    });
  });
});
