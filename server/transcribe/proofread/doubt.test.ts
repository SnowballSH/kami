// @vitest-environment node
import { describe, expect, it } from "vitest";
import { doubtfulWords, isDoubtfulWord } from "./doubt";
import { proofreadOf, wordOf } from "./testing";

describe("doubt", () => {
  it("never doubts a game word, however unsure the reader was", () => {
    expect(isDoubtfulWord(wordOf("sumikui", 0.1))).toBe(false);
  });

  it("doubts an English word the reader was unsure of", () => {
    expect(isDoubtfulWord(wordOf("photo", 0.5))).toBe(true);
    expect(isDoubtfulWord(wordOf("photo", 0.9))).toBe(false);
  });

  it("doubts an unknown word unless the reader was quite sure of it", () => {
    expect(isDoubtfulWord(wordOf("sunikui", 0.85))).toBe(true);
    expect(isDoubtfulWord(wordOf("deane", 0.97))).toBe(false);
    expect(isDoubtfulWord(wordOf("xy", 0.1))).toBe(false);
  });

  it("doubts a number that is not a plain quantity", () => {
    expect(isDoubtfulWord(wordOf("0.5.9", 1, null))).toBe(true);
    expect(isDoubtfulWord(wordOf("0.5x", 0.2, null))).toBe(false);
    expect(isDoubtfulWord(wordOf("-10", 0.2, null))).toBe(false);
    expect(isDoubtfulWord(wordOf("=", 0.1, null))).toBe(false);
  });

  it("lists the doubtful words of a note", () => {
    const note = proofreadOf([wordOf("summon"), wordOf("the"), wordOf("sunikui", 0.4)]);
    expect(doubtfulWords(note).map(({ text }) => text)).toEqual(["sunikui"]);
  });
});
