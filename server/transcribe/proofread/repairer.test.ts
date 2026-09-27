import { describe, expect, it } from "vitest";
import type { FetchLike } from "../../llm/chatClient";
import { DEFAULT_REPAIR_LIMITS, LlmRepairer } from "./repairer";
import { REPAIR_SYSTEM_PROMPT } from "./repairPrompt";
import { proofreadOf, TEST_LEXICON, wordOf } from "./testing";

const LLM = { url: "http://llm.test", model: "gpt-6-luna" };
const NOTE = proofreadOf(
  [wordOf("summon"), wordOf("the"), { ...wordOf("sunikui", 0.4), nearby: ["sumikui"] }],
  ["summon the sumikui"],
);

interface Asked {
  readonly body: {
    readonly model: string;
    readonly messages: readonly { readonly role: string; readonly content: string }[];
  };
  readonly signal: AbortSignal | null | undefined;
}

const answering =
  (reply: unknown, asked: Asked[] = []): FetchLike =>
  async (_url, init) => {
    asked.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  };

describe("LlmRepairer", () => {
  it("asks the model with what was read, the other readings and the unsure words", async () => {
    const asked: Asked[] = [];
    const repairer = new LlmRepairer(
      LLM,
      TEST_LEXICON,
      answering({ text: "summon the sumikui" }, asked),
    );
    expect(await repairer.repair(NOTE)).toEqual({ text: "summon the sumikui" });
    const [system, user] = asked[0]?.body.messages ?? [];
    expect(system?.content).toBe(REPAIR_SYSTEM_PROMPT);
    expect(JSON.parse(user?.content ?? "")).toEqual({
      read: "summon the sunikui",
      otherReadings: ["summon the sumikui"],
      unsureWords: [{ word: "sunikui", sureness: 0.4, nearGameWords: ["sumikui"] }],
    });
    expect(asked[0]?.body.model).toBe("gpt-6-luna");
  });

  it("remembers a repair by what was read", async () => {
    const asked: Asked[] = [];
    const repairer = new LlmRepairer(
      LLM,
      TEST_LEXICON,
      answering({ text: "summon the sumikui" }, asked),
    );
    await repairer.repair(NOTE);
    expect(await repairer.repair(NOTE)).toEqual({ text: "summon the sumikui" });
    expect(asked).toHaveLength(1);
  });

  it("passes on the model's word that the ink is not writing", async () => {
    const repairer = new LlmRepairer(LLM, TEST_LEXICON, answering({ text: null }));
    expect(await repairer.repair(NOTE)).toEqual({ text: null });
  });

  it("has nothing to offer when the model rewrites the note or answers nonsense", async () => {
    for (const reply of [{ text: "summon a big friendly rabbit" }, { words: "hi" }, "no"]) {
      const repairer = new LlmRepairer(LLM, TEST_LEXICON, answering(reply));
      expect(await repairer.repair(NOTE)).toBeUndefined();
    }
  });

  it("gives up when the model is slow, down, or the player moved on", async () => {
    const never: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted"))),
      );
    const slow = new LlmRepairer(LLM, TEST_LEXICON, never, {
      ...DEFAULT_REPAIR_LIMITS,
      timeoutMs: 20,
    });
    expect(await slow.repair(NOTE)).toBeUndefined();
    const down = new LlmRepairer(LLM, TEST_LEXICON, async () => new Response("", { status: 502 }));
    expect(await down.repair(NOTE)).toBeUndefined();
    const withdrawn = new AbortController();
    const pending = new LlmRepairer(LLM, TEST_LEXICON, never).repair(NOTE, withdrawn.signal);
    withdrawn.abort();
    expect(await pending).toBeUndefined();
  });

  it("asks no more at once than its concurrency allows", async () => {
    let release: () => void = () => {};
    const held: FetchLike = () =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            Response.json({ choices: [{ message: { content: '{"text":"summon the sumikui"}' } }] }),
          );
      });
    const repairer = new LlmRepairer(LLM, TEST_LEXICON, held, {
      ...DEFAULT_REPAIR_LIMITS,
      concurrency: 1,
    });
    const first = repairer.repair(NOTE);
    const other = proofreadOf([wordOf("alice"), wordOf("is"), wordOf("xqz", 0.2)]);
    expect(await repairer.repair(other)).toBeUndefined();
    release();
    expect(await first).toEqual({ text: "summon the sumikui" });
  });
});
