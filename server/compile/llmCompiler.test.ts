// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chatCompletionsUrl, createLlmCompiler, type FetchLike } from "./llmCompiler";

const CONFIG = { url: "http://gx10.local:8000", model: "kami-rules", apiKey: "secret" } as const;

interface SeenRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: { model: string; messages: { role: string; content: string }[] };
}

const modelSaying = (content: string, seen: SeenRequest[] = []): FetchLike => {
  return async (url, init) => {
    seen.push({
      url,
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ choices: [{ message: { role: "assistant", content } }] });
  };
};

describe("createLlmCompiler", () => {
  it("asks the model once and returns its effect", async () => {
    const seen: SeenRequest[] = [];
    const reply =
      '{"effect":{"governs":"gravity","x":0,"y":0.38},"explanation":"gravity = 0.38 g (Mars)"}';
    const rule = await createLlmCompiler(CONFIG, modelSaying(reply, seen)).compile(
      "make it feel like the red planet",
    );
    expect(rule).toEqual({
      effect: { governs: "gravity", x: 0, y: 0.38 },
      explanation: "gravity = 0.38 g (Mars)",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://gx10.local:8000/v1/chat/completions");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(seen[0]?.body.model).toBe("kami-rules");
    expect(seen[0]?.body.messages.at(-1)).toEqual({
      role: "user",
      content: "make it feel like the red planet",
    });
    expect(seen[0]?.body.messages[0]?.content).toContain('"governs":"bounciness"');
  });

  it("sends no bearer token when there is no key", async () => {
    const seen: SeenRequest[] = [];
    const { apiKey: _apiKey, ...keyless } = CONFIG;
    await createLlmCompiler(keyless, modelSaying('{"effect":null}', seen)).compile("hello");
    expect(seen[0]?.headers.has("authorization")).toBe(false);
  });

  it("reads JSON wrapped in prose or code fences", async () => {
    const reply =
      'Sure!\n```json\n{"effect":{"governs":"friction","value":0},"explanation":"friction off"}\n```';
    expect(await createLlmCompiler(CONFIG, modelSaying(reply)).compile("like an ice rink")).toEqual(
      {
        effect: { governs: "friction", value: 0 },
        explanation: "friction off",
      },
    );
  });

  it("clamps what the model asks for and writes a gloss if it forgot one", async () => {
    const fast = await createLlmCompiler(
      CONFIG,
      modelSaying('{"effect":{"governs":"timeScale","value":50}}'),
    ).compile("ludicrous speed");
    expect(fast).toEqual({
      effect: { governs: "timeScale", value: 3 },
      explanation: "timeScale = 3",
    });

    const storm = await createLlmCompiler(
      CONFIG,
      modelSaying('{"effect":{"governs":"wind","x":-99,"y":0.5},"explanation":" a storm "}'),
    ).compile("hurricane from the east");
    expect(storm).toEqual({ effect: { governs: "wind", x: -3, y: 0.5 }, explanation: "a storm" });
  });

  it.each([
    ["not a rule", '{"effect":null}'],
    ["garbage", "I am a large language model"],
    ["broken JSON", '{"effect":{"governs":"gravity",'],
    ["an unknown setting", '{"effect":{"governs":"magnetism","value":1},"explanation":"x"}'],
    ["a non-numeric value", '{"effect":{"governs":"friction","value":"lots"},"explanation":"x"}'],
  ])("returns null for %s", async (_what, reply) => {
    expect(await createLlmCompiler(CONFIG, modelSaying(reply)).compile("anything")).toBeNull();
  });

  it("returns null when the model is down, errors or answers in the wrong shape", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const erroring: FetchLike = async () => new Response("boom", { status: 500 });
    const wrongShape: FetchLike = async () => Response.json({ choices: [] });
    for (const broken of [down, erroring, wrongShape]) {
      expect(await createLlmCompiler(CONFIG, broken).compile("g = moon")).toBeNull();
    }
  });

  it("is off, and never fetches, without a configuration", async () => {
    const seen: SeenRequest[] = [];
    const compiler = createLlmCompiler(null, modelSaying('{"effect":null}', seen));
    expect(await compiler.compile("g = moon")).toBeNull();
    expect(seen).toHaveLength(0);
  });
});

describe("chatCompletionsUrl", () => {
  it("accepts a server root, a /v1 base or the full endpoint", () => {
    const endpoint = "http://gx10.local:8000/v1/chat/completions";
    expect(chatCompletionsUrl("http://gx10.local:8000")).toBe(endpoint);
    expect(chatCompletionsUrl("http://gx10.local:8000/v1/")).toBe(endpoint);
    expect(chatCompletionsUrl(endpoint)).toBe(endpoint);
  });
});
