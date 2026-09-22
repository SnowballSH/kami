// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmCompiler } from "../compile/llmCompiler";
import { createLlmTranscriber } from "../transcribe/llmTranscriber";
import type { FetchLike } from "./chatClient";

const CONFIG = { url: "http://localhost:11434", model: "local" };
const LOAD_TIME_MS = 45_000;

const delayedReply =
  (content: string): FetchLike =>
  async (_url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(Response.json({ choices: [{ message: { content } }] })),
        LOAD_TIME_MS,
      );
      init?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        },
        { once: true },
      );
    });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("local model startup", () => {
  it.each(["rules", "handwriting"] as const)(
    "allows a slow %s cold start while bounding interactive requests",
    async (kind) => {
      vi.useFakeTimers();
      vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), delay);
        return controller.signal;
      });
      const compiler = createLlmCompiler(
        CONFIG,
        delayedReply('{"effect":{"governs":"flight","value":1}}'),
      );
      const transcriber = createLlmTranscriber(CONFIG, delayedReply('{"text":"hi"}'));
      if (transcriber === null) throw new Error("missing test transcriber");
      const model = kind === "rules" ? compiler : transcriber;

      const warming = model.warmUp();
      await vi.advanceTimersByTimeAsync(LOAD_TIME_MS);
      expect(await warming).toBe(true);

      const reading =
        kind === "rules"
          ? compiler.compile("Alice can fly")
          : transcriber.transcribe([[{ x: 0, y: 0 }]]);
      await vi.advanceTimersByTimeAsync(LOAD_TIME_MS);
      expect(await reading).toBeNull();
    },
  );
});
