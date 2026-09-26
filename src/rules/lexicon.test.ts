import { describe, expect, it } from "vitest";
import { SummoningLexicon, WISH_WORDS } from "../summoning";
import { RULE_WORDS } from "./lexicon";

describe("the words the offline grammars read", () => {
  it("lists every word of the laws, the places and the travel verbs, as written", () => {
    for (const word of ["gravity", "sumikui", "bouncy", "the", "moon", "teleport", "wonderland"]) {
      expect(RULE_WORDS.has(word), word).toBe(true);
    }
    expect([...RULE_WORDS].every((word) => /^[a-z]+$/.test(word))).toBe(true);
  });

  it("lists the wish grammar's words and every name a thing is summoned by", () => {
    for (const word of ["summon", "conjure", "dozen", "beside"]) {
      expect(WISH_WORDS.has(word), word).toBe(true);
    }
    const names = new SummoningLexicon(["hot air balloon", "rabbit"]).names;
    expect(names).toEqual(expect.arrayContaining(["rabbits", "hot air balloons", "hotairballoon"]));
  });
});
