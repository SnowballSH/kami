import { describe, expect, it } from "vitest";
import { alignWords, differenceShare } from "./align";

describe("differenceShare", () => {
  it("is the share of the longer word that differs", () => {
    expect(differenceShare("moon", "moon")).toBe(0);
    expect(differenceShare("mass", "MARS")).toBe(0.25);
    expect(differenceShare("", "")).toBe(0);
    expect(differenceShare("ab", "xy")).toBe(1);
  });
});

describe("alignWords", () => {
  it("pairs each word with the other reading's word for it", () => {
    expect(alignWords(["gravity", "like", "mass"], ["gravity", "like", "mars"])).toEqual([
      "gravity",
      "like",
      "mars",
    ]);
  });

  it("finds two words where one reading ran them together", () => {
    expect(alignWords(["clonealice"], ["clone", "alice"])).toEqual(["clone alice"]);
    expect(alignWords(["asely", "mouse"], ["a", "shy", "mouse"])).toEqual(["a shy", "mouse"]);
  });

  it("leaves a word without a reading when the other has nothing like it", () => {
    expect(alignWords(["the", "wholeship", "spins"], ["the", "spins"])).toEqual([
      "the",
      undefined,
      "spins",
    ]);
  });

  it("lets two lone symbols stand for one mark", () => {
    expect(alignWords(["air", "-", "50"], ["air", "=", "50"])).toEqual(["air", "=", "50"]);
  });
});
