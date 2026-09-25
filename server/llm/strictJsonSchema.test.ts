// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlmCompiler } from "../compile/llmCompiler";
import { createLlmSceneCompiler } from "../scene/llmSceneCompiler";
import { HI_STROKES } from "../transcribe/hiStrokes";
import { createLlmTranscriber } from "../transcribe/llmTranscriber";
import type { FetchLike } from "./chatClient";
import { type JsonSchema, strictJsonSchema } from "./strictJsonSchema";

const CONFIG = { url: "http://llm.example:8000", model: "gpt-like" } as const;

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodesOf = (value: unknown): readonly JsonSchema[] => {
  if (Array.isArray(value)) return value.flatMap(nodesOf);
  if (!isSchema(value)) return [];
  return [value, ...Object.values(value).flatMap(nodesOf)];
};

/** What OpenAI's strict structured outputs refuse, as the complaints it would answer with. */
const strictViolations = (schema: JsonSchema): readonly string[] =>
  nodesOf(schema).flatMap((node) => {
    const complaints: string[] = [];
    for (const keyword of ["oneOf", "$schema", "minLength", "maxLength"])
      if (keyword in node) complaints.push(`'${keyword}' is not permitted`);
    if (node.type === "object") {
      const names = Object.keys(isSchema(node.properties) ? node.properties : {});
      const required = Array.isArray(node.required) ? node.required : [];
      if (node.additionalProperties !== false)
        complaints.push("'additionalProperties' is required to be supplied and to be false");
      const missing = names.filter((name) => !required.includes(name));
      if (missing.length > 0) complaints.push(`'required' is missing ${missing.join(", ")}`);
    }
    return complaints;
  });

type Body = {
  response_format?: { type: string; json_schema?: { schema: JsonSchema } };
  messages: { content: string | { type: string; text?: string }[] }[];
};

const mentionsJson = ({ messages }: Body): boolean =>
  messages.some(({ content }) =>
    /json/i.test(
      typeof content === "string" ? content : content.map((part) => part.text ?? "").join(" "),
    ),
  );

/** A server as strict as OpenAI about response formats, answering `reply` to what it accepts. */
const openAiLike = (reply: string, bodies: Body[]): FetchLike => {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const format = body.response_format;
    const complaints =
      format?.type === "json_schema"
        ? strictViolations(format.json_schema?.schema ?? {})
        : format?.type === "json_object" && !mentionsJson(body)
          ? ["'messages' must contain the word 'json' in some form, to use 'response_format'"]
          : [];
    return complaints.length > 0
      ? Response.json({ error: { message: `response_format: ${complaints[0]}` } }, { status: 400 })
      : Response.json({ choices: [{ message: { role: "assistant", content: reply } }] });
  };
};

describe("strictJsonSchema", () => {
  it("turns oneOf into anyOf, closes every object and requires every property", () => {
    const schema = strictJsonSchema(
      z.object({
        pick: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("all") }),
          z.object({ kind: z.literal("named"), name: z.string().min(1).max(40) }),
        ]),
        note: z.string().nullish(),
        list: z.array(z.object({ x: z.number(), label: z.string().nullish() })).nullish(),
      }),
    );
    expect(strictViolations(schema)).toEqual([]);
    expect(schema.required).toEqual(["pick", "note", "list"]);
    expect(nodesOf(schema).some((node) => "anyOf" in node)).toBe(true);
  });

  it("refuses an optional property the reply schema would not accept as null", () => {
    expect(() => strictJsonSchema(z.object({ note: z.string().optional() }))).toThrow(
      /"note" must also be nullable/,
    );
  });
});

describe("every model client against a server as strict as OpenAI", () => {
  it("gets the rule compiler's structured reply on the first request", async () => {
    const bodies: Body[] = [];
    const reply = '{"effect":{"governs":"gravity","x":0,"y":0.38},"explanation":null}';
    const rule = await createLlmCompiler(CONFIG, openAiLike(reply, bodies)).compile("mars");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format?.type).toBe("json_schema");
    expect(rule?.effect).toEqual({ governs: "gravity", x: 0, y: 0.38 });
    expect(rule?.explanation).toBeTruthy();
  });

  it("gets the scene compiler's structured reply on the first request", async () => {
    const bodies: Body[] = [];
    const reply = JSON.stringify({
      place: "Mars",
      laws: [{ effect: { governs: "gravity", x: 0, y: 0.38 }, explanation: null }],
      props: null,
      line: null,
    });
    const scene = await createLlmSceneCompiler(
      CONFIG,
      () => true,
      openAiLike(reply, bodies),
    ).compile("take us to mars");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format?.type).toBe("json_schema");
    expect(scene?.laws).toHaveLength(1);
    expect(scene?.props).toEqual([]);
  });

  it("gets the handwriting reader's structured reply on the first request", async () => {
    const bodies: Body[] = [];
    const transcriber = createLlmTranscriber(CONFIG, openAiLike('{"text":"hi"}', bodies));
    expect(await transcriber?.transcribe(HI_STROKES)).toBe("hi");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format?.type).toBe("json_schema");
  });
});
