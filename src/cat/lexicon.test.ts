import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE,
  ASK_WHAT_IT_IS,
  forbiddenThingLine,
  NEAR_ENOUGH,
  OFFER_HELP,
  REFUSALS,
  smallestThingLine,
  TAG_LINES,
} from "./lines";
import { KEYWORDS, resolveNature } from "./natureResolver";
import { parsePhrase } from "./phrase";
import { CANDIDATES } from "./shapeGuesser";

const MAX_WORDS = 15;
const LONGEST_KEYWORD = KEYWORDS.reduce(
  (longest, { keyword }) => (keyword.length > longest.length ? keyword : longest),
  "",
);

const EVERY_LINE: readonly string[] = [
  ASK_WHAT_IT_IS,
  OFFER_HELP,
  NEAR_ENOUGH,
  ...Object.values(REFUSALS),
  ...Object.values(TAG_LINES),
  ...Object.values(ACCEPTANCE).flat(),
  forbiddenThingLine(LONGEST_KEYWORD),
  smallestThingLine(LONGEST_KEYWORD),
];

describe("the Cat's lines", () => {
  it.each(EVERY_LINE)("%j is short and in character", (line) => {
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
    expect(line).not.toMatch(/error|invalid/i);
  });
});

describe("the lexicon", () => {
  it("gives every keyword exactly one nature", () => {
    const seen = new Map<string, string>();
    const clashes = KEYWORDS.flatMap(({ keyword, stems }) => {
      const stemmed = stems.join(" ");
      const earlier = seen.get(stemmed);
      seen.set(stemmed, keyword);
      return earlier === undefined ? [] : [`${earlier} / ${keyword}`];
    });
    expect(clashes).toEqual([]);
  });

  it("lets the longest match win", () => {
    expect(resolveNature(parsePhrase("a bowling ball"))?.nature).toBe("heavy");
    expect(resolveNature(parsePhrase("a hot air balloon"))?.keyword).toBe("hot air balloon");
    expect(resolveNature(parsePhrase("peanut butter"))?.nature).toBe("sticky");
  });

  it("lets the player's own adjective overrule the noun, but keeps the noun for the line", () => {
    expect(resolveNature(parsePhrase("a bouncy balloon"))).toMatchObject({ nature: "bouncy" });
    expect(resolveNature(parsePhrase("a heavy feather"))).toMatchObject({ nature: "heavy" });
    expect(resolveNature(parsePhrase("a bouncy mushroom"))).toEqual({
      nature: "bouncy",
      keyword: "mushroom",
      kind: "thing",
    });
  });

  it("hears animals as creatures, by what they do", () => {
    expect(resolveNature(parsePhrase("a cat"))?.nature).toBe("walker");
    expect(resolveNature(parsePhrase("the white rabbit"))?.nature).toBe("hopper");
    expect(resolveNature(parsePhrase("a bird"))?.nature).toBe("flier");
    expect(resolveNature(parsePhrase("a flying pig"))?.nature).toBe("flier");
    expect(resolveNature(parsePhrase("a hopping dog"))?.nature).toBe("hopper");
  });

  it("hears plurals", () => {
    expect(resolveNature(parsePhrase("two mushrooms"))?.nature).toBe("bouncy");
    expect(resolveNature(parsePhrase("glasses of water"))?.nature).toBe("shrink");
  });

  it("names every guess chip so that it means what the chip promised", () => {
    for (const { name, nature } of Object.values(CANDIDATES).flat()) {
      expect(resolveNature(parsePhrase(name))?.nature ?? "ink", name).toBe(nature);
    }
  });
});
