import { z } from "zod";
import type { CompiledRule, Governs, Scene, SceneCompiler } from "../../src/rules/types";
import { clampEffect, describeEffect } from "../compile/effectRanges";
import { ChatClient, type FetchLike, type LlmConfig, lastJsonObject } from "../llm/chatClient";
import { strictJsonSchema } from "../llm/strictJsonSchema";
import { rawRuleEffectSchema } from "../schemas";
import { SCENE_SYSTEM_PROMPT } from "./prompt";

const REQUEST_TIMEOUT_MS = 40_000;
const MAX_REPLY_TOKENS = 2000;
const MAX_LAWS = 5;
const MAX_PROPS = 6;
const MAX_TEXT = 80;

/** Where a prop may land, in px from the top-centre of the words: on screen, above the writing. */
export const PROP_REACH = { x: 450, yHigh: -350, yLow: -40 } as const;
export const PROP_SIZE = { min: 0.3, max: 2 } as const;

const finite = z.number().finite();

const replySchema = z.object({
  place: z.string().nullable(),
  laws: z
    .array(z.object({ effect: rawRuleEffectSchema, explanation: z.string().nullish() }))
    .nullish(),
  props: z
    .array(
      z.object({
        word: z.string(),
        at: z.object({ x: finite, y: finite }),
        size: finite,
      }),
    )
    .nullish(),
  line: z.string().nullish(),
});
const replyJsonSchema = strictJsonSchema(replySchema);

type Reply = z.infer<typeof replySchema>;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const lawsOf = (laws: NonNullable<Reply["laws"]>): readonly CompiledRule[] => {
  const seen = new Set<Governs>();
  const compiled: CompiledRule[] = [];
  for (const law of laws) {
    const effect = clampEffect(law.effect);
    if (seen.has(effect.governs) || compiled.length >= MAX_LAWS) continue;
    seen.add(effect.governs);
    const explanation = law.explanation?.trim().slice(0, MAX_TEXT);
    compiled.push({ effect, explanation: explanation || describeEffect(effect) });
  }
  return compiled;
};

const propsOf = (props: NonNullable<Reply["props"]>, drawable: (word: string) => boolean) =>
  props
    .map(({ word, at, size }) => ({
      word: word.trim().toLowerCase(),
      at: {
        x: clamp(at.x, -PROP_REACH.x, PROP_REACH.x),
        y: clamp(at.y, PROP_REACH.yHigh, PROP_REACH.yLow),
      },
      size: clamp(size, PROP_SIZE.min, PROP_SIZE.max),
    }))
    .filter(({ word }) => word.length > 0 && drawable(word))
    .slice(0, MAX_PROPS);

export const parseSceneReply = (
  content: string,
  drawable: (word: string) => boolean,
): Scene | null => {
  const reply = replySchema.safeParse(lastJsonObject(content));
  if (!reply.success || reply.data.place === null) return null;
  const place = reply.data.place.trim().slice(0, MAX_TEXT);
  const laws = lawsOf(reply.data.laws ?? []);
  const props = propsOf(reply.data.props ?? [], drawable);
  if (place.length === 0 || (laws.length === 0 && props.length === 0)) return null;
  const line = reply.data.line?.trim().slice(0, MAX_TEXT * 2);
  return { place, laws, props, line: line || `${place}. Here we are.` };
};

/** Asks the model to make a place of "teleport us to a chocolate factory"; never for the atlas's own. */
export class LlmSceneCompiler implements SceneCompiler {
  readonly #chat: ChatClient;

  constructor(
    config: LlmConfig,
    private readonly drawable: (word: string) => boolean,
    fetchFn: FetchLike = fetch,
  ) {
    this.#chat = new ChatClient(config, fetchFn);
  }

  async compile(text: string): Promise<Scene | null> {
    const content = await this.#chat.ask(
      [
        { role: "system", content: SCENE_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      {
        maxTokens: MAX_REPLY_TOKENS,
        timeoutMs: REQUEST_TIMEOUT_MS,
        jsonSchema: replyJsonSchema,
      },
    );
    return content === null ? null : parseSceneReply(content, this.drawable);
  }
}

const NO_SCENES: SceneCompiler = { compile: () => Promise.resolve(null) };

export const createLlmSceneCompiler = (
  config: LlmConfig | null,
  drawable: (word: string) => boolean,
  fetchFn?: FetchLike,
): SceneCompiler => (config === null ? NO_SCENES : new LlmSceneCompiler(config, drawable, fetchFn));
