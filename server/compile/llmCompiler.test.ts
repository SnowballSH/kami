// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chatCompletionsUrl, createLlmCompiler, type FetchLike } from "./llmCompiler";

const CONFIG = { url: "http://gx10.local:8000", model: "kami-rules", apiKey: "secret" } as const;

interface SeenRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: {
    model: string;
    max_tokens: number;
    reasoning_effort?: string;
    response_format?: { type: string; json_schema?: { schema: unknown } };
    messages: { role: string; content: string }[];
  };
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
    expect(seen[0]?.body.response_format?.type).toBe("json_schema");
    expect(seen[0]?.body.response_format?.json_schema?.schema).toMatchObject({ type: "object" });
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

  it("accepts laws on Alice and the weather, clamped like the rest", async () => {
    const crowd = await createLlmCompiler(
      CONFIG,
      modelSaying('{"effect":{"governs":"clones","value":40},"explanation":"a crowd of Alices"}'),
    ).compile("an army of alices");
    expect(crowd).toEqual({
      effect: { governs: "clones", value: 8 },
      explanation: "a crowd of Alices",
    });

    const dusk = await createLlmCompiler(
      CONFIG,
      modelSaying('{"effect":{"governs":"daylight","value":0.3},"explanation":"dusk"}'),
    ).compile("the sun is going down");
    expect(dusk).toEqual({ effect: { governs: "daylight", value: 0.3 }, explanation: "dusk" });
  });

  it("accepts laws on drawings, with their target, clamped like the rest", async () => {
    const wheel = await createLlmCompiler(
      CONFIG,
      modelSaying(
        '{"effect":{"governs":"spin","of":{"kind":"named","name":"wheel"},"value":40},"explanation":"round it goes"}',
      ),
    ).compile("the wheel spins like mad");
    expect(wheel).toEqual({
      effect: { governs: "spin", of: { kind: "named", name: "wheel" }, value: 5 },
      explanation: "round it goes",
    });

    const rocket = await createLlmCompiler(
      CONFIG,
      modelSaying('{"effect":{"governs":"thrust","of":{"kind":"all"},"x":0,"y":-9}}'),
    ).compile("everything lifts off");
    expect(rocket).toEqual({
      effect: { governs: "thrust", of: { kind: "all" }, x: 0, y: -3 },
      explanation: "everything: thrust = (0, -3) g",
    });
  });

  it("rounds fractional model clone counts after clamping", async () => {
    const compiler = createLlmCompiler(
      CONFIG,
      modelSaying('{"effect":{"governs":"clones","value":2.5}}'),
    );
    expect((await compiler.compile("copies"))?.effect).toEqual({ governs: "clones", value: 3 });
  });

  it.each([
    ["not a rule", '{"effect":null}'],
    ["a drawing law with no target", '{"effect":{"governs":"spin","value":1},"explanation":"x"}'],
    [
      "a drawing law aimed at nothing sensible",
      '{"effect":{"governs":"mass","of":{"kind":"alice"},"value":2},"explanation":"x"}',
    ],
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

describe("replies shaped like a real thinking model's", () => {
  const MARS = {
    effect: { governs: "gravity", x: 0, y: 0.38 },
    explanation: "gravity = 0.38 g (Mars)",
  };
  const MARS_JSON = JSON.stringify(MARS);

  it("ignores a reasoning block, even one with braces in it", async () => {
    const reply = `<think>The user wants {"governs":"gravity"} maybe? Mars is 0.38 g.</think>\n${MARS_JSON}`;
    expect(await createLlmCompiler(CONFIG, modelSaying(reply)).compile("red planet")).toEqual(MARS);
  });

  it("reads JSON out of a code fence with chatter around it", async () => {
    const reply = `Sure! Here you go:\n\`\`\`json\n${MARS_JSON}\n\`\`\`\nHope that helps {smile}.`;
    expect(await createLlmCompiler(CONFIG, modelSaying(reply)).compile("red planet")).toEqual(MARS);
  });

  it("is not fooled by braces inside the gloss", async () => {
    const reply = '{"effect":{"governs":"timeScale","value":0.5},"explanation":"time {slow} 0.5x"}';
    const rule = await createLlmCompiler(CONFIG, modelSaying(reply)).compile("bullet time");
    expect(rule?.effect).toEqual({ governs: "timeScale", value: 0.5 });
  });

  it("gives up quietly on reasoning that never finished", async () => {
    const reply = "<think>Let me consider what gravity on Mars is, it is about";
    expect(await createLlmCompiler(CONFIG, modelSaying(reply)).compile("red planet")).toBeNull();
  });

  it("leaves room for reasoning in the token budget", async () => {
    const seen: SeenRequest[] = [];
    await createLlmCompiler(CONFIG, modelSaying(MARS_JSON, seen)).compile("red planet");
    expect(seen[0]?.body.max_tokens).toBeGreaterThanOrEqual(1000);
  });
});

describe("warmUp", () => {
  it("reports whether the model answered at all", async () => {
    expect(await createLlmCompiler(CONFIG, modelSaying("hi")).warmUp()).toBe(true);
    const unreachable: FetchLike = async () => {
      throw new TypeError("connection refused");
    };
    expect(await createLlmCompiler(CONFIG, unreachable).warmUp()).toBe(false);
    expect(await createLlmCompiler(null).warmUp()).toBe(false);
  });
});

describe("reasoning", () => {
  const MARS_JSON = '{"effect":{"governs":"gravity","x":0,"y":0.38},"explanation":"Mars"}';

  it("asks for none, because a one-line rule does not need a chain of thought", async () => {
    const seen: SeenRequest[] = [];
    await createLlmCompiler(CONFIG, modelSaying(MARS_JSON, seen)).compile("red planet");
    expect(seen[0]?.body.reasoning_effort).toBe("none");
  });

  it("drops the field, once and for good, for a server that rejects it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const strict: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return "reasoning_effort" in body
        ? new Response("Unrecognized request argument supplied: reasoning_effort", {
            status: 400,
          })
        : Response.json({ choices: [{ message: { role: "assistant", content: MARS_JSON } }] });
    };
    const compiler = createLlmCompiler(CONFIG, strict);
    expect((await compiler.compile("red planet"))?.effect).toMatchObject({ governs: "gravity" });
    expect((await compiler.compile("red planet again"))?.effect).toMatchObject({
      governs: "gravity",
    });
    expect(bodies.map((body) => "reasoning_effort" in body)).toEqual([true, false, false]);
    expect(bodies.every((body) => "response_format" in body)).toBe(true);
  });

  it("falls back when a server rejects JSON mode", async () => {
    const bodies: Record<string, unknown>[] = [];
    const strict: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      return "response_format" in body
        ? new Response("unknown field", { status: 400 })
        : Response.json({ choices: [{ message: { role: "assistant", content: MARS_JSON } }] });
    };
    const compiler = createLlmCompiler(CONFIG, strict);
    expect((await compiler.compile("red planet"))?.effect).toMatchObject({ governs: "gravity" });
    expect(bodies.map((body) => "response_format" in body)).toEqual([true, true, false]);
  });
});
