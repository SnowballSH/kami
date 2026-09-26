// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Transcript } from "../types";
import { VocabularyCorrector } from "./corrector";
import { Lexicon } from "./lexicon";

const lexicon = new Lexicon(
  [
    "alice",
    "sumikui",
    "summon",
    "the",
    "a",
    "moon",
    "gravity",
    "like",
    "mars",
    "pluto",
    "clone",
    "tiny",
    "shy",
    "mouse",
    "hero",
    "is",
    "at",
    "pulls",
    "g",
    "daylight",
    "air",
    "cat",
    "eat",
    "me",
    "make",
    "fly",
    "no",
  ],
  ["photo", "robot", "guards", "dice", "friend", "my", "mass", "bob"],
  ["doleful"],
);
const corrector = new VocabularyCorrector(lexicon);

const sure = (text: string, alternatives: readonly string[] = []): Transcript => ({
  text,
  sureness: Array.from(text, () => 0.95),
  alternatives,
});

const unsureAt = (text: string, word: string, sureness: number): Transcript => {
  const at = text.indexOf(word);
  return {
    text,
    sureness: Array.from(text, (_, index) =>
      index >= at && index < at + word.length ? sureness : 0.95,
    ),
  };
};

describe("VocabularyCorrector", () => {
  it("leaves words it knows as they are", () => {
    expect(corrector.correct(sure("summon the sumikui")).text).toBe("summon the sumikui");
    expect(corrector.correct(sure("the robot guards dice")).text).toBe("the robot guards dice");
    expect(corrector.correct(sure("my friend bob")).text).toBe("my friend bob");
  });

  it("snaps an unknown word to the game word it is a common misreading of", () => {
    expect(corrector.correct(sure("summon the sunikui")).text).toBe("summon the sumikui");
    expect(corrector.correct(sure("the rnoon")).text).toBe("the moon");
    expect(corrector.correct(unsureAt("make alise fly", "alise", 0.2)).text).toBe("make alice fly");
  });

  it("keeps an unknown word no known word is clearly closer to", () => {
    const read = corrector.correct(sure("make alise fly"));
    expect(read.text).toBe("make alise fly");
    expect(read.words[1]).toMatchObject({ read: "alise", kind: null, nearby: ["alice"] });
  });

  it("takes the game word another reading saw where this one read something else", () => {
    expect(
      corrector.correct({
        ...unsureAt("gravity like photo", "photo", 0.4),
        alternatives: ["gravity like pluto"],
      }).text,
    ).toBe("gravity like pluto");
  });

  it("does not let another reading overrule an English word the reader was sure of", () => {
    expect(corrector.correct(sure("my photo", ["my pluto"])).text).toBe("my photo");
  });

  it("splits two words run together, one of them the game's", () => {
    expect(corrector.correct(sure("clonealice")).text).toBe("clone alice");
    expect(corrector.correct(sure("atiny hero")).text).toBe("a tiny hero");
    expect(corrector.correct(sure("asely mouse", ["a shy mouse"])).text).toBe("a shy mouse");
  });

  it("reads a lone dash between a subject and a number as an equals sign", () => {
    expect(corrector.correct(sure("daylight - 0.1")).text).toBe("daylight = 0.1");
    expect(corrector.correct(sure("gravity - I g")).text).toBe("gravity = 1 g");
    expect(corrector.correct(sure("alice pulls at - 1 g")).text).toBe("alice pulls at - 1 g");
    expect(corrector.correct(sure("air : 50", ["air = 50"])).text).toBe("air = 50");
  });

  it("mends numbers written with letters, and takes another reading's plainer number", () => {
    expect(corrector.correct(sure("gravity o.3")).text).toBe("gravity 0.3");
    expect(corrector.correct(sure("alice is 0,5x")).text).toBe("alice is 0.5x");
    expect(corrector.correct(sure("time 509b", ["time 50%"])).text).toBe("time 50%");
    expect(corrector.correct(sure("died in 1980s", ["died in 1996"])).text).toBe("died in 1980s");
  });

  it("keeps the writer's capitals and punctuation around a corrected word", () => {
    expect(corrector.correct(sure("Sunikui!")).text).toBe("Sumikui!");
  });

  it("reports each word's sureness and how it is known", () => {
    const read = corrector.correct(unsureAt("no gravlty", "gravlty", 0.4));
    expect(read.words).toEqual([
      { read: "no", text: "no", sureness: 0.95, kind: "game", nearby: [] },
      expect.objectContaining({ read: "gravlty", text: "gravity", sureness: 0.4, kind: "game" }),
    ]);
    expect(read.read).toBe("no gravlty");
  });

  it("works without sureness, as a vision model's transcript has none", () => {
    expect(corrector.correct({ text: "summon the sunikui" }).text).toBe("summon the sumikui");
  });
});
