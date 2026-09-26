import { describe, expect, it } from "vitest";
import { PERISHED_LINES } from "./lines";

const MAX_WORDS = 15;

describe("what Kami says when the heat takes a drawing", () => {
  it.each(Object.values(PERISHED_LINES).flat())("%j is short and in character", (line) => {
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
    expect(line).not.toMatch(/error|invalid/i);
  });

  it("has words for every nature the heat can take", () => {
    expect(Object.keys(PERISHED_LINES).sort()).toEqual(["floaty", "slippery"]);
  });
});
