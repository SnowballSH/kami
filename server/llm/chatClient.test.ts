// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ChatClient, type FetchLike, type LlmConfig } from "./chatClient";
import { DEFAULT_REQUEST_SHAPE, degradeAfterRejection, parseReasoningEffort } from "./requestShape";

const CONFIG: LlmConfig = { url: "http://gateway.test", model: "any" };
const MESSAGES = [{ role: "user", content: "hello" }] as const;
const OPTIONS = { maxTokens: 100, timeoutMs: 1000, jsonSchema: { type: "object" } };

type Body = Record<string, unknown>;

const rejection = (message: string): Response =>
  Response.json({ error: { message, type: "invalid_request_error" } }, { status: 400 });

const answer = (content: string | null = '{"ok":true}'): Response =>
  Response.json({ choices: [{ message: { role: "assistant", content } }] });

/** A server that rejects each body `refuse` complains about, with that complaint. */
const serverRefusing = (refuse: (body: Body) => string | null, bodies: Body[] = []): FetchLike => {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const complaint = refuse(body);
    return complaint === null ? answer() : rejection(complaint);
  };
};

describe("ChatClient against servers with different tastes", () => {
  it("sends every optional feature to a server that takes them all", async () => {
    const bodies: Body[] = [];
    const client = new ChatClient(
      CONFIG,
      serverRefusing(() => null, bodies),
    );
    expect(await client.ask(MESSAGES, OPTIONS)).toBe('{"ok":true}');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "any",
      temperature: 0,
      max_tokens: 100,
      reasoning_effort: "none",
      response_format: { type: "json_schema" },
    });
  });

  it("keeps reasoning control against a gateway to Anthropic that refuses response_format", async () => {
    const bodies: Body[] = [];
    const modelgate = serverRefusing(
      (body) =>
        "response_format" in body ? "response_format is not supported for anthropic models" : null,
      bodies,
    );
    const client = new ChatClient(CONFIG, modelgate);
    expect(await client.ask(MESSAGES, OPTIONS)).toBe('{"ok":true}');
    expect(bodies.map((body) => "response_format" in body)).toEqual([true, true, false]);
    expect(bodies.at(-1)).toMatchObject({ reasoning_effort: "none", max_tokens: 100 });

    expect(await client.ask(MESSAGES, OPTIONS)).toBe('{"ok":true}');
    expect(bodies).toHaveLength(4);
    expect(bodies[3]).not.toHaveProperty("response_format");
    expect(bodies[3]).toHaveProperty("reasoning_effort", "none");
  });

  it("learns the gpt-5 family's spelling without losing structured output", async () => {
    const bodies: Body[] = [];
    const openai = serverRefusing((body) => {
      if ("max_tokens" in body)
        return "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
      if ("temperature" in body)
        return "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.";
      if (body.reasoning_effort === "none")
        return "Unsupported value: 'reasoning_effort' does not support 'none' with this model.";
      return null;
    }, bodies);
    const client = new ChatClient(CONFIG, openai);
    expect(await client.ask(MESSAGES, OPTIONS)).toBe('{"ok":true}');
    expect(bodies).toHaveLength(4);
    expect(bodies.at(-1)).toMatchObject({
      max_completion_tokens: 100,
      response_format: { type: "json_schema" },
    });
    expect(bodies.at(-1)).not.toHaveProperty("temperature");
    expect(bodies.at(-1)).not.toHaveProperty("reasoning_effort");
    expect(client.shape).toEqual({
      reasoning: false,
      responseFormat: "json_schema",
      tokenLimit: "max_completion_tokens",
      temperature: false,
    });
  });

  it("steps down structured output before reasoning when the error names nothing", async () => {
    const bodies: Body[] = [];
    const terse = serverRefusing(
      (body) => ("reasoning_effort" in body ? "bad request" : null),
      bodies,
    );
    expect(await new ChatClient(CONFIG, terse).ask(MESSAGES, OPTIONS)).toBe('{"ok":true}');
    expect(
      bodies.map((body) => [
        (body.response_format as { type?: string } | undefined)?.type ?? "none",
        "reasoning_effort" in body,
      ]),
    ).toEqual([
      ["json_schema", true],
      ["json_object", true],
      ["none", true],
      ["none", false],
    ]);
  });

  it("asks for a plain JSON object when the caller has no schema", async () => {
    const bodies: Body[] = [];
    const { jsonSchema: _schema, ...schemaless } = OPTIONS;
    await new ChatClient(
      CONFIG,
      serverRefusing(() => null, bodies),
    ).ask(MESSAGES, schemaless);
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
  });

  it("gives up after a bounded number of attempts on a request that is simply bad", async () => {
    const bodies: Body[] = [];
    const client = new ChatClient(
      CONFIG,
      serverRefusing(() => "unsupported content part: image_url", bodies),
    );
    expect(await client.ask(MESSAGES, OPTIONS)).toBeNull();
    expect(bodies).toHaveLength(6);
    expect(await client.ask(MESSAGES, OPTIONS)).toBeNull();
    expect(bodies).toHaveLength(7);
  });

  it("does not change shape on errors other than 400", async () => {
    const bodies: Body[] = [];
    const overloaded: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Body);
      return new Response("busy", { status: 503 });
    };
    const client = new ChatClient(CONFIG, overloaded);
    expect(await client.ask(MESSAGES, OPTIONS)).toBeNull();
    expect(bodies).toHaveLength(1);
    expect(client.shape).toEqual(DEFAULT_REQUEST_SHAPE);
  });

  it("sends the configured reasoning effort, or never the field when it is off", async () => {
    const bodies: Body[] = [];
    const server = serverRefusing(() => null, bodies);
    await new ChatClient({ ...CONFIG, reasoningEffort: "high" }, server).ask(MESSAGES, OPTIONS);
    await new ChatClient({ ...CONFIG, reasoningEffort: null }, server).ask(MESSAGES, OPTIONS);
    expect(bodies[0]?.reasoning_effort).toBe("high");
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("reads a refusal with null content as no answer", async () => {
    const client = new ChatClient(CONFIG, async () => answer(null));
    expect(await client.ask(MESSAGES, OPTIONS)).toBeNull();
  });
});

describe("degradeAfterRejection", () => {
  it("blames the field the error names, wherever it stands in the order", () => {
    expect(
      degradeAfterRejection(DEFAULT_REQUEST_SHAPE, "'temperature' does not support 0"),
    ).toEqual({ ...DEFAULT_REQUEST_SHAPE, temperature: false });
    expect(
      degradeAfterRejection(
        DEFAULT_REQUEST_SHAPE,
        "'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
      ),
    ).toEqual({
      ...DEFAULT_REQUEST_SHAPE,
      tokenLimit: "max_completion_tokens",
    });
  });

  it("does not mistake one field for another with a similar name", () => {
    const withoutTokens = {
      ...DEFAULT_REQUEST_SHAPE,
      tokenLimit: "max_completion_tokens",
    } as const;
    expect(degradeAfterRejection(withoutTokens, "max_completion_tokens too large")).toEqual({
      ...withoutTokens,
      responseFormat: "json_object",
    });
  });

  it("has nothing left once every feature is gone", () => {
    expect(
      degradeAfterRejection(
        {
          reasoning: false,
          responseFormat: "none",
          tokenLimit: "max_completion_tokens",
          temperature: false,
        },
        "anything",
      ),
    ).toBeNull();
  });
});

describe("parseReasoningEffort", () => {
  it("accepts the known levels in any case, and off", () => {
    expect(parseReasoningEffort(" Medium ", "X")).toBe("medium");
    expect(parseReasoningEffort("xhigh", "X")).toBe("xhigh");
    expect(parseReasoningEffort("OFF", "X")).toBeNull();
  });

  it("refuses a level no server knows", () => {
    expect(() => parseReasoningEffort("max", "KAMI_LLM_REASONING_EFFORT")).toThrow(
      /KAMI_LLM_REASONING_EFFORT must be one of/,
    );
  });
});
