// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/core/geometry";
import type { ChatPart } from "../llm/chatClient";
import { createLlmTranscriber, parseTranscription, readsAsWriting } from "./llmTranscriber";

const CONFIG = { url: "http://127.0.0.1:11434", model: "qwen3.8:latest" } as const;

const WORD: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
  ],
  [
    { x: 0, y: 20 },
    { x: 20, y: 20 },
  ],
];

interface SeenRequest {
  readonly body: {
    model: string;
    max_tokens: number;
    reasoning_effort?: string;
    messages: { role: string; content: string | ChatPart[] }[];
  };
  readonly signal: AbortSignal | null | undefined;
}

const modelSaying = (content: string, seen: SeenRequest[] = []) => {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    seen.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json({ choices: [{ message: { role: "assistant", content } }] });
  };
};

describe("readsAsWriting", () => {
  it("wants at least two different letters on one line", () => {
    expect(readsAsWriting("make alice fly")).toBe(true);
    expect(readsAsWriting("g = moon")).toBe(true);
    expect(readsAsWriting("IIIIII")).toBe(false);
    expect(readsAsWriting("O")).toBe(false);
    expect(readsAsWriting("")).toBe(false);
    expect(readsAsWriting("a".repeat(81))).toBe(false);
  });
});

describe("parseTranscription", () => {
  it("reads the text out of the model's JSON, however it is wrapped", () => {
    expect(parseTranscription('{"text": "no gravity"}')).toBe("no gravity");
    expect(parseTranscription('Sure!\n```json\n{"text":"slow  motion "}\n```')).toBe("slow motion");
    expect(parseTranscription('<think>hmm</think>{"text": "alice is huge"}')).toBe("alice is huge");
  });

  it("is null for a drawing, a doodle that spells nothing, or nonsense", () => {
    expect(parseTranscription('{"text": null}')).toBeNull();
    expect(parseTranscription('{"text": "IIIIII"}')).toBeNull();
    expect(parseTranscription("a ladder")).toBeNull();
    expect(parseTranscription('{"words": "hi"}')).toBeNull();
  });
});

describe("createLlmTranscriber", () => {
  it("only enables the reader after it reads the known PNG correctly", async () => {
    const seen: SeenRequest[] = [];
    const transcriber = createLlmTranscriber(CONFIG, modelSaying('{"text":"HI"}', seen));
    expect(transcriber?.ready).toBe(false);
    expect(await transcriber?.warmUp()).toBe(true);
    expect(transcriber?.ready).toBe(true);
    const content = seen[0]?.body.messages.at(-1)?.content;
    expect(Array.isArray(content) && content.some((part) => part.type === "image_url")).toBe(true);
  });

  it.each(['{"text":null}', '{"text":"cat"}', "Images are unsupported", ""])(
    "keeps transcription unavailable after an incorrect image answer: %s",
    async (content) => {
      const transcriber = createLlmTranscriber(CONFIG, modelSaying(content));
      expect(await transcriber?.warmUp()).toBe(false);
      expect(transcriber?.ready).toBe(false);
    },
  );

  it("revokes readiness when a later image check fails", async () => {
    let available = true;
    const transcriber = createLlmTranscriber(CONFIG, async () =>
      available
        ? Response.json({ choices: [{ message: { content: '{"text":"HI"}' } }] })
        : new Response("no vision", { status: 400 }),
    );
    expect(await transcriber?.warmUp()).toBe(true);
    available = false;
    expect(await transcriber?.warmUp()).toBe(false);
    expect(transcriber?.ready).toBe(false);
  });

  it("shows the model the strokes as a PNG and asks for no chain of thought", async () => {
    const seen: SeenRequest[] = [];
    const transcriber = createLlmTranscriber(CONFIG, modelSaying('{"text":"hi there"}', seen));
    expect(await transcriber?.transcribe(WORD)).toBe("hi there");
    const [request] = seen;
    expect(request?.body.model).toBe("qwen3.8:latest");
    expect(request?.body.reasoning_effort).toBe("none");
    expect(request?.body.max_tokens).toBeLessThan(200);
    const user = request?.body.messages.at(-1);
    expect(user?.role).toBe("user");
    const parts = Array.isArray(user?.content) ? user.content : [];
    const [image] = parts;
    expect(image?.type).toBe("image_url");
    if (image?.type === "image_url") {
      expect(image.image_url.url.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  it("asks nothing about no strokes", async () => {
    const seen: SeenRequest[] = [];
    const transcriber = createLlmTranscriber(CONFIG, modelSaying('{"text":"ghost"}', seen));
    expect(await transcriber?.transcribe([])).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it("gives up quietly when the model is down or the caller leaves", async () => {
    const down = createLlmTranscriber(CONFIG, async () => new Response("no", { status: 503 }));
    expect(await down?.transcribe(WORD)).toBeNull();

    const controller = new AbortController();
    const seen: SeenRequest[] = [];
    const patient = createLlmTranscriber(CONFIG, async (_url, init) => {
      seen.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const reading = patient?.transcribe(WORD, { signal: controller.signal });
    controller.abort();
    expect(await reading).toBeNull();
    expect(seen[0]?.signal?.aborted).toBe(true);
  });

  it("is nothing without a model", () => {
    expect(createLlmTranscriber(null)).toBeNull();
  });
});
