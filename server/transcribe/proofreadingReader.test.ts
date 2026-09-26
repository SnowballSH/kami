// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/core/geometry";
import type { Proofread } from "./proofread/corrector";
import { VocabularyCorrector } from "./proofread/corrector";
import type { HandwritingRepairer, Repair } from "./proofread/repairer";
import { TEST_LEXICON } from "./proofread/testing";
import { ProofreadingReader } from "./proofreadingReader";
import type { HandwritingTranscriber, Transcript } from "./types";

const INK: readonly Stroke[] = [
  [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
  ],
];
const MORE_INK: readonly Stroke[] = [...INK, [{ x: 10, y: 0 }]];

const reading = (text: string, sureness: number): Transcript => ({
  text,
  sureness: Array.from(text, () => sureness),
});

class ScriptedTranscriber implements HandwritingTranscriber {
  readonly ready = true;
  reads = 0;

  constructor(private readonly says: Transcript | null) {}

  warmUp = async (): Promise<boolean> => true;

  transcribe = async (): Promise<Transcript | null> => {
    this.reads += 1;
    return this.says;
  };
}

class ScriptedRepairer implements HandwritingRepairer {
  readonly asked: Proofread[] = [];

  constructor(private readonly answer: Repair | undefined) {}

  repair = async (proofread: Proofread): Promise<Repair | undefined> => {
    this.asked.push(proofread);
    return this.answer;
  };
}

const corrector = new VocabularyCorrector(TEST_LEXICON);

describe("ProofreadingReader", () => {
  it("answers with the proofread words, and null for a drawing", async () => {
    const words = new ProofreadingReader(
      new ScriptedTranscriber(reading("summon the sunikui", 0.95)),
      corrector,
      null,
    );
    expect(await words.read(INK)).toEqual({ text: "summon the sumikui", unsure: false });
    const drawing = new ProofreadingReader(new ScriptedTranscriber(null), corrector, null);
    expect(await drawing.read(INK)).toEqual({ text: null, unsure: false });
  });

  it("says it was unsure only when a settled read could ask the model", async () => {
    const unsure = reading("alice is xqzv", 0.3);
    expect(
      await new ProofreadingReader(new ScriptedTranscriber(unsure), corrector, null).read(INK),
    ).toEqual({ text: "alice is xqzv", unsure: false });
    const repairer = new ScriptedRepairer({ text: "alice is tiny" });
    const reader = new ProofreadingReader(new ScriptedTranscriber(unsure), corrector, repairer);
    expect(await reader.read(INK)).toEqual({ text: "alice is xqzv", unsure: true });
    expect(repairer.asked).toHaveLength(0);
  });

  it("never doubts a vision model's reading, which has no sureness", async () => {
    const repairer = new ScriptedRepairer({ text: "alice is tiny" });
    const reader = new ProofreadingReader(
      new ScriptedTranscriber({ text: "alice is xqzv" }),
      corrector,
      repairer,
    );
    expect(await reader.read(INK, { settled: true })).toEqual({
      text: "alice is xqzv",
      unsure: false,
    });
    expect(repairer.asked).toHaveLength(0);
  });

  it("asks the model about a settled note it was unsure of, reading the ink only once", async () => {
    const transcriber = new ScriptedTranscriber(reading("alice is xqzv", 0.3));
    const repairer = new ScriptedRepairer({ text: "alice is tiny" });
    const reader = new ProofreadingReader(transcriber, corrector, repairer);
    await reader.read(INK);
    expect(await reader.read(INK, { settled: true })).toEqual({
      text: "alice is tiny",
      unsure: false,
    });
    expect(transcriber.reads).toBe(1);
    expect(repairer.asked[0]?.text).toBe("alice is xqzv");
    await reader.read(MORE_INK, { settled: true });
    expect(transcriber.reads).toBe(2);
  });

  it("keeps the proofread words when the model has nothing to offer, and its null when it says so", async () => {
    const unsure = reading("alice is xqzv", 0.3);
    const silent = new ProofreadingReader(
      new ScriptedTranscriber(unsure),
      corrector,
      new ScriptedRepairer(undefined),
    );
    expect(await silent.read(INK, { settled: true })).toEqual({
      text: "alice is xqzv",
      unsure: false,
    });
    const scribble = new ProofreadingReader(
      new ScriptedTranscriber(unsure),
      corrector,
      new ScriptedRepairer({ text: null }),
    );
    expect(await scribble.read(INK, { settled: true })).toEqual({ text: null, unsure: false });
  });
});
