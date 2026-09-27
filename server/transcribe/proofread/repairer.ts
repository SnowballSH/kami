import { z } from "zod";
import { WorkLimit } from "../../http/workLimit";
import { ChatClient, type FetchLike, type LlmConfig, lastJsonObject } from "../../llm/chatClient";
import { strictJsonSchema } from "../../llm/strictJsonSchema";
import { Recent } from "../../recent";
import { asWriting } from "../types";
import type { Proofread } from "./corrector";
import { DEFAULT_FAITHFULNESS, type FaithfulnessLimits, isFaithful } from "./faithful";
import type { Lexicon } from "./lexicon";
import { REPAIR_SYSTEM_PROMPT, repairQuestion } from "./repairPrompt";

export interface RepairLimits {
  /** How long one repair may take before the proofread text stands. */
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly requestsPerMinute: number;
  /** How many notes' repairs are remembered, by what was read. */
  readonly cacheSize: number;
  readonly faithfulness: FaithfulnessLimits;
}

export const DEFAULT_REPAIR_LIMITS: RepairLimits = {
  timeoutMs: 4_000,
  concurrency: 2,
  requestsPerMinute: 120,
  cacheSize: 256,
  faithfulness: DEFAULT_FAITHFULNESS,
};

const MAX_REPLY_TOKENS = 120;
const replySchema = z.object({ text: z.string().nullable() });
const replyJsonSchema = strictJsonSchema(replySchema);

/** A repair: the note as the model reconstructed it, or null for "not writing". */
export type Repair = { readonly text: string | null };

export interface HandwritingRepairer {
  /** The model's reconstruction, or undefined when there is none to trust (busy, slow, unfaithful). */
  repair(proofread: Proofread, signal?: AbortSignal): Promise<Repair | undefined>;
}

/**
 * Asks a text model to reconstruct a note the reader was unsure of, from what was read, the other
 * readings and the game words near each unsure word. Bounded in time and in concurrency; every
 * failure leaves the proofread text standing.
 */
export class LlmRepairer implements HandwritingRepairer {
  readonly #chat: ChatClient;
  readonly #limits: RepairLimits;
  readonly #work: WorkLimit;
  readonly #recent: Recent<Repair>;
  readonly #lexicon: Lexicon;

  constructor(
    config: LlmConfig,
    lexicon: Lexicon,
    fetchFn: FetchLike = fetch,
    limits = DEFAULT_REPAIR_LIMITS,
  ) {
    this.#chat = new ChatClient(config, fetchFn);
    this.#lexicon = lexicon;
    this.#limits = limits;
    this.#work = new WorkLimit(limits.requestsPerMinute, limits.concurrency);
    this.#recent = new Recent(limits.cacheSize);
  }

  async repair(proofread: Proofread, signal?: AbortSignal): Promise<Repair | undefined> {
    const question = repairQuestion(proofread);
    const remembered = this.#recent.get(question);
    if (remembered !== undefined) return remembered;
    const leave = this.#work.enter();
    if (leave === null) return undefined;
    try {
      const content = await this.#chat.ask(
        [
          { role: "system", content: REPAIR_SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
        {
          maxTokens: MAX_REPLY_TOKENS,
          timeoutMs: this.#limits.timeoutMs,
          jsonSchema: replyJsonSchema,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      const repair = content === null ? undefined : this.#trusted(proofread, content);
      if (repair !== undefined) this.#recent.set(question, repair);
      return repair;
    } finally {
      leave();
    }
  }

  #trusted(proofread: Proofread, content: string): Repair | undefined {
    const reply = replySchema.safeParse(lastJsonObject(content));
    if (!reply.success) return undefined;
    if (reply.data.text === null) return { text: null };
    const text = asWriting(reply.data.text);
    return text !== null && isFaithful(proofread, text, this.#lexicon, this.#limits.faithfulness)
      ? { text }
      : undefined;
  }
}
