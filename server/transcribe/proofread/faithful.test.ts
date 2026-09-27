import { describe, expect, it } from "vitest";
import { isFaithful } from "./faithful";
import { proofreadOf, TEST_LEXICON, wordOf } from "./testing";

const note = proofreadOf([wordOf("summon"), wordOf("the"), wordOf("sunikui", 0.4)]);

describe("isFaithful", () => {
  it("accepts a repair of the doubtful words into game words", () => {
    expect(isFaithful(note, "summon the sumikui", TEST_LEXICON)).toBe(true);
    expect(isFaithful(note, "Summon the sumikui.", TEST_LEXICON)).toBe(true);
  });

  it("refuses to change a word the note was sure of", () => {
    expect(isFaithful(note, "summon a sumikui", TEST_LEXICON)).toBe(false);
  });

  it("refuses a doubtful word turned into a word nobody vouches for", () => {
    expect(isFaithful(note, "summon the sunikoi", TEST_LEXICON)).toBe(false);
    expect(isFaithful(note, "summon the robot", TEST_LEXICON)).toBe(false);
  });

  it("accepts a word another reading saw", () => {
    const seen = proofreadOf(
      [wordOf("gravity"), wordOf("like"), wordOf("photo", 0.3)],
      ["gravity like pluto"],
    );
    expect(isFaithful(seen, "gravity like pluto", TEST_LEXICON)).toBe(true);
    expect(isFaithful(seen, "gravity like mars", TEST_LEXICON)).toBe(false);
    const unknown = proofreadOf([wordOf("gravity"), wordOf("like"), wordOf("rnarz", 0.3)]);
    expect(isFaithful(unknown, "gravity like mars", TEST_LEXICON)).toBe(true);
  });

  it("refuses added or dropped words and rewrites", () => {
    expect(isFaithful(note, "please summon the big sumikui", TEST_LEXICON)).toBe(false);
    expect(isFaithful(note, "summon", TEST_LEXICON)).toBe(false);
    const long = proofreadOf([wordOf("alice"), wordOf("is"), wordOf("xqzvwj", 0.2)]);
    expect(isFaithful(long, "alice is a rabbit", TEST_LEXICON)).toBe(false);
  });

  it("turns an English word into another only by a misreading's worth of edits", () => {
    const english = proofreadOf([wordOf("gravity"), wordOf("like"), wordOf("mass", 0.5, "common")]);
    expect(isFaithful(english, "gravity like mars", TEST_LEXICON)).toBe(true);
    expect(isFaithful(english, "gravity like moon", TEST_LEXICON)).toBe(false);
  });

  it("keeps every number the note was sure of", () => {
    const law = proofreadOf([wordOf("gravity"), wordOf("=", 1, null), wordOf("0.5", 1, null)]);
    expect(isFaithful(law, "gravity = 0.5", TEST_LEXICON)).toBe(true);
    expect(isFaithful(law, "gravity = 5", TEST_LEXICON)).toBe(false);
  });
});
