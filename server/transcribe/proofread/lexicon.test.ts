import { describe, expect, it } from "vitest";
import { createNatureTable } from "../../natures/natureTable";
import { createKamiLexicon, gameWordsOf, Lexicon } from "./lexicon";

describe("the Kami lexicon", () => {
  const lexicon = createKamiLexicon();

  it("knows the game's words from the game's own sources", () => {
    for (const word of [
      "gravity",
      "sumikui",
      "inkeater",
      "teleport",
      "moon",
      "wonderland",
      "summon",
      "rabbits",
      "mushroom",
      "eat",
      "alice",
      "kami",
      "seven",
    ]) {
      expect(lexicon.kindOf(word), word).toBe("game");
    }
  });

  it("tells everyday English from rarer English and from nothing at all", () => {
    expect(lexicon.kindOf("because")).toBe("common");
    expect(lexicon.kindOf("Yesterday")).toBe("common");
    expect(lexicon.kindOf("doleful")).toBe("rare");
    expect(lexicon.kindOf("sunikui")).toBeNull();
  });

  it("reads contractions, possessives and hyphenated words by what they are made of", () => {
    expect(lexicon.kindOf("it's")).toBe("game");
    expect(lexicon.kindOf("moon's")).toBe("game");
    expect(lexicon.kindOf("ink-eater")).toBe("game");
    expect(lexicon.kindOf("because-moon")).toBe("common");
    expect(lexicon.kindOf("ink-sunikui")).toBeNull();
  });

  it("offers only game words and everyday English to snap to", () => {
    const targets = new Map(lexicon.targets());
    expect(targets.get("alice")).toBe("game");
    expect(targets.get("because")).toBe("common");
    expect(targets.has("doleful")).toBe(false);
  });
});

describe("gameWordsOf", () => {
  it("takes every Quick, Draw! category's names and its display name", () => {
    const natures = createNatureTable({
      "hot air balloon": { name: "a hot air balloon", nature: "floaty", strength: 1, line: "Up." },
    });
    const words = new Lexicon(gameWordsOf(natures), [], []);
    for (const word of ["hot", "air", "balloon", "balloons", "hotairballoon"]) {
      expect(words.kindOf(word), word).toBe("game");
    }
  });
});
